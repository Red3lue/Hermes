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
  loadKeystore,
  saveKeystore,
  tryLoadKeystore,
  type Keystore,
} from "./keystore";

export type HermesConfig = {
  ensName: string;
  inboxContract: `0x${string}`;
  publicClient: PublicClient;
  wallet: WalletClient & { account: Account }; // agent's own EOA
  storage: StorageConfig;
  keystorePath?: string; // optional cache; not load-bearing
};

export type ReceivedMessage = {
  from: string;
  text: string;
  ts: number;
  rootHash: `0x${string}`;
  replyTo: `0x${string}`;
  blockNumber: bigint;
};

export class Hermes {
  private cfg: HermesConfig;
  private storage: ZeroGStorage;
  private replay = new ReplayCache();
  private keys: KeyPair | null = null;
  private keyVersion = 1;

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
      }
    }
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

    const recipient = await resolveAgent(toName, this.cfg.publicClient);
    const { ciphertext, nonce } = encryptMessage(
      text,
      recipient.pubkey,
      this.keys.secretKey,
    );

    const unsigned: UnsignedEnvelope = {
      v: 1,
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

    const logs = await readInbox(
      { contract: this.cfg.inboxContract, publicClient: this.cfg.publicClient },
      this.cfg.ensName,
      fromBlock,
    );

    const out: ReceivedMessage[] = [];
    for (const log of logs) {
      try {
        const decoded = await this.decodeLog(log);
        if (decoded) out.push(decoded);
      } catch (err) {
        console.warn(`drop msg ${log.rootHash}:`, (err as Error).message);
      }
    }
    return out;
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
      from: envelope.from,
      text,
      ts: envelope.ts,
      rootHash: log.rootHash,
      replyTo: log.replyTo,
      blockNumber: log.blockNumber,
    };
  }

  private persist(): void {
    if (!this.cfg.keystorePath || !this.keys) return;
    const ks: Keystore = {
      ensName: this.cfg.ensName,
      address: this.cfg.wallet.account.address,
      keyVersion: this.keyVersion,
      x25519: this.keys,
    };
    saveKeystore(this.cfg.keystorePath, ks);
  }
}
