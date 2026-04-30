import {
  type PublicClient,
  type WalletClient,
  type Account,
  type Hash,
} from "viem";
import { resolveAgent, setAgentRecords, type AgentRecords } from "./ens";
import {
  generateKeyPairFromSignature,
  encryptMessage,
  decryptMessage,
  signEIP191,
  verifyEIP191,
  type KeyPair,
} from "./crypto";
import {
  envelopeSigningPayload,
  serializeEnvelope,
  parseEnvelope,
  ReplayCache,
  type Envelope,
  type UnsignedEnvelope,
} from "./envelope";
import {
  appendToInbox,
  replyToInbox,
  readInbox,
  type InboxMessage,
} from "./inbox";
import { ZeroGStorage, type StorageConfig } from "./storage";
import {
  getLastHistoryRoot,
  historyKey,
  loadKeystore,
  saveKeystore,
  setLastHistoryRoot,
  tryLoadKeystore,
  type Keystore,
} from "./keystore";
import {
  defaultPolicy,
  mergePolicy,
  assertSendAllowed,
  assertReceiveAllowed,
  assertBridgeAllowed,
  PolicyDeniedError,
  type AgentPolicy,
  type AgentPolicyPatch,
  type BridgeChannel,
} from "./policy";
import {
  joinBiome,
  buildBiomeEnvelope,
  decryptBiomeEnvelope,
  type BiomeContext,
  type BiomeDoc,
} from "./biome";
import { buildHistoryManifest, type ManifestEntry } from "./manifest";

export type PolicyDropInfo = {
  err: PolicyDeniedError;
  channel: { kind: "public" } | { kind: "biome"; name: string };
  rootHash?: `0x${string}`;
  from?: string;
};

export type HermesConfig = {
  ensName: string;
  inboxContract: `0x${string}`;
  publicClient: PublicClient;
  wallet: WalletClient & { account: Account }; // agent's own EOA
  storage: StorageConfig;
  keystorePath?: string; // optional cache; not load-bearing
  /** Called when a received message is filtered out by policy. */
  onPolicyDrop?: (info: PolicyDropInfo) => void;
};

export type ReceivedMessage = {
  origin: "public";
  from: string;
  text: string;
  ts: number;
  rootHash: `0x${string}`;
  replyTo: `0x${string}`;
  blockNumber: bigint;
};

export type BiomeReceivedMessage = {
  origin: "biome";
  biomeName: string;
  from: string;
  text: string;
  ts: number;
  rootHash: `0x${string}`;
  blockNumber: bigint;
  biomeVersion: number;
  thread?: string;
};

export type BridgeArgs = {
  from: BridgeChannel;
  to: BridgeChannel;
  message: string;
};

export type BridgeResult =
  | { kind: "public"; rootHash: `0x${string}`; tx: Hash }
  | {
      kind: "biome";
      rootHash: `0x${string}`;
      tx: Hash;
      historyRoot?: `0x${string}`;
    };

type CachedBiome = {
  K: Uint8Array;
  doc: BiomeDoc;
  version: number;
  root: `0x${string}`;
};

export type SendToBiomeOptions = {
  thread?: string;
  context?: `0x${string}`;
  /**
   * Override the auto-chained `history` rootHash. If omitted, the client
   * pulls the last history root for this (biome, thread) from the keystore.
   * Pass `null` to explicitly skip chaining for this send.
   */
  history?: `0x${string}` | null;
  /**
   * Default true: after upload, build a history manifest entry and update
   * the keystore's lastHistoryRoot for this (biome, thread).
   */
  chainHistory?: boolean;
};

export class Hermes {
  private cfg: HermesConfig;
  private storage: ZeroGStorage;
  private replay = new ReplayCache();
  private keys: KeyPair | null = null;
  private keyVersion = 1;
  private biomeCache = new Map<string, CachedBiome>();
  private historyMem = new Map<string, `0x${string}`>();
  private policyState: AgentPolicy = defaultPolicy();
  private inboundPeersMem = new Set<string>();

  constructor(cfg: HermesConfig) {
    this.cfg = cfg;
    this.storage = new ZeroGStorage(cfg.storage);
    if (cfg.keystorePath) {
      const ks = tryLoadKeystore(cfg.keystorePath);
      if (ks) {
        if (
          ks.address.toLowerCase() !== cfg.wallet.account.address.toLowerCase()
        ) {
          throw new Error(
            `keystore address ${ks.address} does not match wallet ${cfg.wallet.account.address}`,
          );
        }
        this.keys = ks.x25519;
        this.keyVersion = ks.keyVersion;
        for (const [k, v] of Object.entries(ks.lastHistoryRoots ?? {})) {
          this.historyMem.set(k, v);
        }
        if (ks.policy) this.policyState = ks.policy;
        for (const peer of ks.inboundPeers ?? []) {
          this.inboundPeersMem.add(peer);
        }
      }
    }
  }

  /** Read-only snapshot of the current policy. */
  get policy(): AgentPolicy {
    return JSON.parse(JSON.stringify(this.policyState)) as AgentPolicy;
  }

  /** Merge `patch` into the current policy and persist (if a keystore is set). */
  updatePolicy(patch: AgentPolicyPatch): AgentPolicy {
    this.policyState = mergePolicy(this.policyState, patch);
    this.persist();
    return this.policy;
  }

  /** Test/seed hook: mark a peer as having sent us a message before. */
  recordInboundPeer(peer: string): void {
    if (this.inboundPeersMem.has(peer)) return;
    this.inboundPeersMem.add(peer);
    this.persist();
  }

  /** Derive keys from wallet sig + publish ENS records. Idempotent on keys. */
  async register(): Promise<void> {
    if (!this.keys) {
      this.keys = await generateKeyPairFromSignature(
        this.cfg.wallet,
        this.keyVersion,
      );
    }
    const records: AgentRecords = {
      addr: this.cfg.wallet.account.address,
      pubkey: this.keys.publicKey,
      inbox: `${this.cfg.inboxContract}:${this.cfg.ensName}`,
    };
    await setAgentRecords(
      this.cfg.ensName,
      records,
      this.cfg.publicClient,
      this.cfg.wallet,
    );
    this.persist();
  }

  async send(
    toName: string,
    text: string,
    replyTo?: `0x${string}`,
  ): Promise<{ rootHash: `0x${string}`; tx: Hash }> {
    if (!this.keys) throw new Error("call register() first or load a keystore");

    assertSendAllowed(this.policyState, {
      channel: { kind: "public", peer: toName },
      hasPriorInbound: this.inboundPeersMem.has(toName),
    });

    const recipient = await resolveAgent(toName, this.cfg.publicClient);
    const { ciphertext, nonce } = encryptMessage(
      text,
      recipient.pubkey,
      this.keys.secretKey,
    );

    const unsigned: UnsignedEnvelope = {
      v: 2,
      from: this.cfg.ensName,
      to: toName,
      ts: Math.floor(Date.now() / 1000),
      nonce,
      ciphertext,
      ephemeralPubKey: this.keys.publicKey,
      replyTo,
    };
    const sig = await signEIP191(
      this.cfg.wallet,
      envelopeSigningPayload(unsigned),
    );
    const envelope: Envelope = { ...unsigned, sig };

    const rootHash = await this.storage.uploadBlob(serializeEnvelope(envelope));

    const inboxCfg = {
      contract: this.cfg.inboxContract,
      publicClient: this.cfg.publicClient,
      wallet: this.cfg.wallet,
    };
    const tx = replyTo
      ? await replyToInbox(inboxCfg, toName, replyTo, rootHash)
      : await appendToInbox(inboxCfg, toName, rootHash);

    return { rootHash, tx };
  }

  async fetchInbox(fromBlock: bigint = 0n): Promise<ReceivedMessage[]> {
    if (!this.keys) throw new Error("call register() first or load a keystore");

    try {
      assertReceiveAllowed(this.policyState, { channel: { kind: "public" } });
    } catch (err) {
      if (err instanceof PolicyDeniedError) {
        this.cfg.onPolicyDrop?.({ err, channel: { kind: "public" } });
        return [];
      }
      throw err;
    }

    const logs = await readInbox(
      { contract: this.cfg.inboxContract, publicClient: this.cfg.publicClient },
      this.cfg.ensName,
      fromBlock,
    );

    const out: ReceivedMessage[] = [];
    for (const log of logs) {
      try {
        const decoded = await this.decodeLog(log);
        if (decoded) {
          out.push(decoded);
          if (!this.inboundPeersMem.has(decoded.from)) {
            this.inboundPeersMem.add(decoded.from);
            this.persist();
          }
        }
      } catch (err) {
        console.warn(`drop msg ${log.rootHash}:`, (err as Error).message);
      }
    }
    return out;
  }

  async sendToBiome(
    biomeName: string,
    text: string,
    opts?: SendToBiomeOptions,
  ): Promise<{
    rootHash: `0x${string}`;
    tx: Hash;
    historyRoot?: `0x${string}`;
  }> {
    if (!this.keys) throw new Error("call register() first or load a keystore");

    assertSendAllowed(this.policyState, {
      channel: { kind: "biome", name: biomeName },
    });

    const biome = await this.loadBiome(biomeName);
    const hKey = historyKey(biomeName, opts?.thread);
    const chain = opts?.chainHistory !== false;
    let priorHistory: `0x${string}` | undefined;
    if (opts?.history === null) {
      priorHistory = undefined;
    } else if (opts?.history !== undefined) {
      priorHistory = opts.history;
    } else {
      priorHistory = this.lookupHistoryRoot(hKey);
    }

    const envelope = await buildBiomeEnvelope(
      {
        fromEns: this.cfg.ensName,
        biomeName,
        biomeVersion: biome.version,
        biomeRoot: biome.root,
        payload: text,
        K: biome.K,
        thread: opts?.thread,
        context: opts?.context,
        history: priorHistory,
      },
      this.cfg.wallet,
    );

    const rootHash = await this.storage.uploadBlob(serializeEnvelope(envelope));
    const tx = await appendToInbox(
      {
        contract: this.cfg.inboxContract,
        publicClient: this.cfg.publicClient,
        wallet: this.cfg.wallet,
      },
      biomeName,
      rootHash,
    );

    let historyRoot: `0x${string}` | undefined;
    if (chain) {
      const entry: ManifestEntry = {
        ts: envelope.ts,
        from: this.cfg.ensName,
        rootHash,
        thread: opts?.thread,
      };
      const built = await buildHistoryManifest({
        entries: [entry],
        prev: priorHistory,
        createdBy: this.cfg.ensName,
        wallet: this.cfg.wallet,
        encrypt: { kind: "biome", K: biome.K },
        storage: this.storage,
      });
      historyRoot = built.root;
      this.recordHistoryRoot(hKey, historyRoot);
    }

    return { rootHash, tx, historyRoot };
  }

  async fetchBiomeInbox(
    biomeName: string,
    fromBlock: bigint = 0n,
  ): Promise<BiomeReceivedMessage[]> {
    if (!this.keys) throw new Error("call register() first or load a keystore");

    try {
      assertReceiveAllowed(this.policyState, {
        channel: { kind: "biome", name: biomeName },
      });
    } catch (err) {
      if (err instanceof PolicyDeniedError) {
        this.cfg.onPolicyDrop?.({
          err,
          channel: { kind: "biome", name: biomeName },
        });
        return [];
      }
      throw err;
    }

    const biome = await this.loadBiome(biomeName);
    const logs = await readInbox(
      { contract: this.cfg.inboxContract, publicClient: this.cfg.publicClient },
      biomeName,
      fromBlock,
    );

    const out: BiomeReceivedMessage[] = [];
    for (const log of logs) {
      try {
        const bytes = await this.storage.downloadBlob(log.rootHash);
        const envelope = parseEnvelope(bytes);

        if (envelope.to !== biomeName || !envelope.biome) continue;
        if (this.replay.check(envelope.from, envelope.nonce)) continue;

        const decoded = await decryptBiomeEnvelope(
          envelope,
          biome.K,
          biome.doc,
          this.cfg.publicClient,
        );
        const biomeMeta = decoded.envelope.biome;
        if (!biomeMeta) continue;

        out.push({
          origin: "biome",
          biomeName,
          from: decoded.envelope.from,
          text: decoded.text,
          ts: decoded.envelope.ts,
          rootHash: log.rootHash,
          blockNumber: log.blockNumber,
          biomeVersion: biomeMeta.version,
          thread: decoded.envelope.thread,
        });
      } catch (err) {
        console.warn(`drop biome msg ${log.rootHash}:`, (err as Error).message);
      }
    }

    return out;
  }

  /**
   * The only sanctioned cross-channel relay. Verifies the directional
   * permission for `(from.kind, to.kind)`, then re-encrypts via `send` /
   * `sendToBiome`. Same `assertSendAllowed` gate applies on the destination
   * leg, so a bridge cannot bypass send-side rules.
   */
  async bridge(args: BridgeArgs): Promise<BridgeResult> {
    assertBridgeAllowed(this.policyState, { from: args.from, to: args.to });
    if (args.to.kind === "public") {
      if (!args.to.peer) {
        throw new Error("bridge: public destination requires `to.peer`");
      }
      const { rootHash, tx } = await this.send(args.to.peer, args.message);
      return { kind: "public", rootHash, tx };
    }
    const { rootHash, tx, historyRoot } = await this.sendToBiome(
      args.to.name,
      args.message,
    );
    return { kind: "biome", rootHash, tx, historyRoot };
  }

  /** Bump key version, re-derive, push new pubkey to ENS. */
  async rotateKeys(): Promise<KeyPair> {
    this.keyVersion += 1;
    const fresh = await generateKeyPairFromSignature(
      this.cfg.wallet,
      this.keyVersion,
    );
    const current = await resolveAgent(this.cfg.ensName, this.cfg.publicClient);
    await setAgentRecords(
      this.cfg.ensName,
      { ...current, pubkey: fresh.publicKey },
      this.cfg.publicClient,
      this.cfg.wallet,
    );
    this.keys = fresh;
    this.persist();
    return fresh;
  }

  private async decodeLog(log: InboxMessage): Promise<ReceivedMessage | null> {
    const bytes = await this.storage.downloadBlob(log.rootHash);
    const envelope = parseEnvelope(bytes);

    if (envelope.to !== this.cfg.ensName) return null;
    if (!envelope.ephemeralPubKey) {
      throw new Error("not a direct message envelope");
    }
    if (this.replay.check(envelope.from, envelope.nonce)) return null;

    const sender = await resolveAgent(envelope.from, this.cfg.publicClient);

    const { sig, ...unsigned } = envelope;
    const sigOk = await verifyEIP191(
      sender.addr,
      envelopeSigningPayload(unsigned),
      sig,
    );
    if (!sigOk) throw new Error("bad signature");

    const text = decryptMessage(
      envelope.ciphertext,
      envelope.nonce,
      envelope.ephemeralPubKey,
      this.keys!.secretKey,
    );

    return {
      origin: "public",
      from: envelope.from,
      text,
      ts: envelope.ts,
      rootHash: log.rootHash,
      replyTo: log.replyTo,
      blockNumber: log.blockNumber,
    };
  }

  private async loadBiome(name: string): Promise<CachedBiome> {
    const cached = this.biomeCache.get(name);
    if (cached) return cached;

    const ctx: BiomeContext = {
      publicClient: this.cfg.publicClient,
      wallet: this.cfg.wallet,
      storage: this.storage,
      myEns: this.cfg.ensName,
      myKeys: this.keys!,
    };
    const joined = await joinBiome(ctx, name);
    const hydrated: CachedBiome = {
      K: joined.K,
      doc: joined.doc,
      version: joined.version,
      root: joined.root,
    };
    this.biomeCache.set(name, hydrated);
    return hydrated;
  }

  private persist(): void {
    if (!this.cfg.keystorePath || !this.keys) return;
    const existing = tryLoadKeystore(this.cfg.keystorePath);
    const ks: Keystore = {
      ensName: this.cfg.ensName,
      address: this.cfg.wallet.account.address,
      keyVersion: this.keyVersion,
      x25519: this.keys,
      biomes: existing?.biomes,
      lastHistoryRoots: existing?.lastHistoryRoots,
      policy: this.policyState,
      inboundPeers: [...this.inboundPeersMem],
    };
    saveKeystore(this.cfg.keystorePath, ks);
  }

  private lookupHistoryRoot(key: string): `0x${string}` | undefined {
    const mem = this.historyMem.get(key);
    if (mem) return mem;
    if (!this.cfg.keystorePath) return undefined;
    return getLastHistoryRoot(this.cfg.keystorePath, key) ?? undefined;
  }

  private recordHistoryRoot(key: string, root: `0x${string}`): void {
    this.historyMem.set(key, root);
    if (this.cfg.keystorePath) {
      setLastHistoryRoot(this.cfg.keystorePath, key, root);
    }
  }
}
