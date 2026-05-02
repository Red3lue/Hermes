import {
  Hermes,
  peekAnima,
  decryptAnima,
  resolveAnimus,
  ZeroGStorage,
  type ReceivedMessage,
  type BiomeReceivedMessage,
  type SendOptions,
} from "@hermes/sdk";
import { getPublicClient, makeWalletClient } from "../chain.js";
import type { AgentDef } from "../registry.js";
import { ensureAgentKeystore, loadKeystoreFile } from "./keystorePrep.js";
import { ensureAgentAnima } from "./soulsPrep.js";

export type Souls = {
  anima?: string; // own anima content
  animus?: string; // biome animus content (decrypted)
  otherAnimas?: Array<{ ens: string; content: string }>; // other agents' animas
};

export type RuntimeContext = {
  agent: AgentDef;
  hermes: Hermes;
  // Convenience helpers
  sendDM: (
    toEns: string,
    body: string,
    opts?: SendOptions,
  ) => Promise<{
    rootHash: `0x${string}`;
    historyRoot?: `0x${string}`;
  }>;
  broadcast: (
    biomeName: string,
    body: string,
  ) => Promise<{ rootHash: `0x${string}` }>;
  /** Fetch own Anima + (if biome member) Animus + optionally other agents'
   * Animas. Returns null fields when records aren't published. Cached by
   * rootHash — re-fetches only if the ENS rootHash changed. */
  resolveSouls: (opts?: {
    biomeName?: string;
    otherAgents?: string[];
  }) => Promise<Souls>;
};

export type RoleHandler = {
  /** Called for every direct message addressed to this agent. */
  onDM?: (msg: ReceivedMessage, ctx: RuntimeContext) => Promise<void>;
  /** Called for every biome broadcast on subscribed biomes. */
  onBiome?: (msg: BiomeReceivedMessage, ctx: RuntimeContext) => Promise<void>;
  /** ENS names of biomes to subscribe to (broadcast inbox polling). */
  subscribedBiomes: string[];
};

export type RuntimeOptions = {
  pollIntervalMs?: number;
  pollJitterMs?: number;
};

const DEFAULT_INTERVAL = 5_000;
const DEFAULT_JITTER = 1_500;

/**
 * Spawn a long-running polling loop for one agent. The agent's identity is
 * its ENS name + X25519 keys (loaded from keystore). All Sepolia inbox txs
 * are sent from the deployer wallet (shared across all agents — see
 * CLAUDE.md notes on the demo-grade compromise).
 *
 * Returns a stop function.
 */
export async function spawnAgentRuntime(
  agent: AgentDef,
  handler: RoleHandler,
  opts: RuntimeOptions = {},
): Promise<() => void> {
  const interval = opts.pollIntervalMs ?? DEFAULT_INTERVAL;
  const jitter = opts.pollJitterMs ?? DEFAULT_JITTER;

  await ensureAgentKeystore(agent);

  // Idempotent: publish the agent's Anima from persona.md if not yet set.
  // Quietly tolerated if it fails (network blip etc.) — runtime keeps
  // booting and resolveSouls will retry on demand.
  try {
    await ensureAgentAnima(agent);
  } catch (err) {
    console.warn(
      `[runtime:${agent.slug}] anima auto-publish failed:`,
      (err as Error).message,
    );
  }

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY required");

  const hermes = new Hermes({
    ensName: agent.ens,
    inboxContract: process.env.HERMES_INBOX_CONTRACT! as `0x${string}`,
    publicClient: getPublicClient(),
    wallet: makeWalletClient(deployerKey),
    storage: {
      rpcUrl: process.env.ZEROG_RPC_URL!,
      indexerUrl: process.env.ZEROG_INDEXER_URL!,
      privateKey: (deployerKey.startsWith("0x")
        ? deployerKey
        : `0x${deployerKey}`) as `0x${string}`,
    },
    keystorePath: `.hermes-runtime/${agent.slug}.json`,
  });

  // For demo: allow coordinator to initiate public conversations so it can
  // dispatch DMs to quorum members even with no prior inbound thread.
  if (agent.roles.includes("coordinator")) {
    try {
      hermes.updatePolicy({ public: { canStartConversations: true } });
      console.log(
        `[runtime:${agent.slug}] policy updated: canStartConversations=true`,
      );
    } catch (err) {
      console.warn(
        `[runtime:${agent.slug}] failed to update policy:`,
        (err as Error).message,
      );
    }
  }

  // The shared deployer wallet signs both the 0G `submit()` (Galileo) and
  // the Sepolia `appendToInbox` for every agent runtime. When several agents
  // dispatch concurrently (e.g. coordinator fanning out to 3 members while
  // members reply with verdicts), ethers' nonce manager can fire two txs
  // at the same nonce → "replacement transaction underpriced" / "nonce too
  // low". Retry with backoff lets the racing tx land first, then we resubmit
  // with a fresh nonce.
  const NONCE_ERR =
    /replacement transaction underpriced|REPLACEMENT_UNDERPRICED|nonce too low|already known/i;
  const RETRIES = 4;
  const BACKOFF_MS = [1500, 3000, 5000, 8000];

  async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let lastErr: unknown;
    for (let i = 0; i <= RETRIES; i++) {
      try {
        return await fn();
      } catch (err) {
        lastErr = err;
        const msg = (err as Error).message ?? "";
        if (!NONCE_ERR.test(msg) || i === RETRIES) throw err;
        const wait = BACKOFF_MS[i] ?? BACKOFF_MS[BACKOFF_MS.length - 1];
        console.warn(
          `[runtime:${agent.slug}] ${label} nonce collision (attempt ${i + 1}/${RETRIES + 1}); retrying in ${wait}ms`,
        );
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  // Soul cache (Anima / Animus). Keyed by ENS for animas, by biome name
  // for animus. Stored content + rootHash; re-fetch if rootHash changes
  // (cheap check: one ENS getText). Lifetime: the runtime process.
  const animaCache = new Map<string, { content: string; root: string }>();
  const animusCache = new Map<string, { content: string; root: string }>();

  /** Fetch + decrypt an Anima. Only works for animas this runtime can
   * decrypt — i.e. the running agent's own (we have its keystore). Animas
   * for *other* agents can be peeked (verify sig + cache rootHash) but
   * not decrypted unless the caller supplies that agent's secret key,
   * which the runtime doesn't have. */
  async function fetchOwnAnima(): Promise<string | undefined> {
    try {
      const r = await peekAnima(
        agent.ens,
        getPublicClient(),
        hermes.blobStorage,
      );
      if (!r) return undefined;
      const cached = animaCache.get(agent.ens);
      if (cached && cached.root === r.root) return cached.content;
      // Decrypt with our keystore-loaded secret.
      const ks = loadKeystoreFile(agent.slug);
      const content = decryptAnima(r.doc, ks.x25519.secretKey);
      animaCache.set(agent.ens, { content, root: r.root });
      return content;
    } catch (err) {
      console.warn(
        `[runtime:${agent.slug}] anima fetch failed:`,
        (err as Error).message,
      );
      return undefined;
    }
  }

  async function fetchAnimus(biomeName: string): Promise<string | undefined> {
    try {
      const K = await hermes.getBiomeKey(biomeName);
      const r = await resolveAnimus(
        biomeName,
        K,
        getPublicClient(),
        hermes.blobStorage,
      );
      if (!r) return undefined;
      const cached = animusCache.get(biomeName);
      if (cached && cached.root === r.root) return cached.content;
      animusCache.set(biomeName, { content: r.content, root: r.root });
      return r.content;
    } catch (err) {
      console.warn(
        `[runtime:${agent.slug}] animus fetch ${biomeName} failed:`,
        (err as Error).message,
      );
      return undefined;
    }
  }

  const ctx: RuntimeContext = {
    agent,
    hermes,
    sendDM: async (toEns, body, opts) =>
      withRetry(`sendDM→${toEns}`, async () => {
        const r = await hermes.send(toEns, body, opts);
        return { rootHash: r.rootHash, historyRoot: r.historyRoot };
      }),
    broadcast: async (biomeName, body) =>
      withRetry(`broadcast→${biomeName}`, async () => {
        const r = await hermes.sendToBiome(biomeName, body);
        return { rootHash: r.rootHash };
      }),
    resolveSouls: async (opts) => {
      // Anima is now encrypted to the agent's own pubkey, so the runtime
      // can only decrypt its OWN. `otherAgents` parameter is preserved
      // for API compatibility but no longer pulls other agents' animas
      // (we don't hold their secret keys).
      void opts?.otherAgents;
      const [anima, animus] = await Promise.all([
        fetchOwnAnima(),
        opts?.biomeName ? fetchAnimus(opts.biomeName) : Promise.resolve(undefined),
      ]);
      return {
        anima,
        animus,
      };
    },
  };

  // Track last seen block per channel to avoid reprocessing.
  // We start from the *current* block on first iteration so we don't replay
  // historical messages on every restart.
  const publicClient = getPublicClient();
  let lastDmBlock = await publicClient.getBlockNumber();
  const lastBiomeBlock = new Map<string, bigint>();
  for (const b of handler.subscribedBiomes) lastBiomeBlock.set(b, lastDmBlock);

  const seenRoots = new Set<`0x${string}`>();
  let stopped = false;

  console.log(
    `[runtime:${agent.slug}] booted at block ${lastDmBlock}, watching ${handler.subscribedBiomes.length} biomes`,
  );

  async function tick() {
    if (stopped) return;
    try {
      // Snapshot the chain head once per tick. We'll advance every cursor
      // (DM + each subscribed biome) up to `head`, so the next tick only
      // looks at strictly-newer blocks. We can't go past `head` — viem will
      // reject `fromBlock > current head` with "block range extends beyond
      // current head block."
      const head = await publicClient.getBlockNumber();

      // 1. Fetch DMs since lastDmBlock
      if (handler.onDM) {
        const sinceDm = lastDmBlock;
        const msgs = await hermes.fetchInbox(sinceDm);
        for (const m of msgs) {
          if (seenRoots.has(m.rootHash)) continue;
          seenRoots.add(m.rootHash);
          // Skip messages from self (shouldn't happen for DMs but defensive)
          if (m.from === agent.ens) continue;
          try {
            await handler.onDM(m, ctx);
          } catch (err) {
            console.warn(
              `[runtime:${agent.slug}] onDM error for ${m.rootHash.slice(0, 12)}…:`,
              (err as Error).message,
            );
          }
        }
        // Advance to head (not head+1) so the next tick won't re-fetch the
        // same logs but stays within a valid `fromBlock` range. New logs
        // landing at the same block will be filtered out by `seenRoots`.
        if (head > sinceDm) lastDmBlock = head;
      }

      // 2. Fetch biome broadcasts for each subscribed biome
      if (handler.onBiome) {
        for (const biomeName of handler.subscribedBiomes) {
          const since = lastBiomeBlock.get(biomeName) ?? 0n;
          const msgs = await hermes.fetchBiomeInbox(biomeName, since);
          for (const m of msgs) {
            if (seenRoots.has(m.rootHash)) continue;
            seenRoots.add(m.rootHash);
            // Skip self-broadcasts (coordinator hearing its own stage events)
            if (m.from === agent.ens) continue;
            try {
              await handler.onBiome(m, ctx);
            } catch (err) {
              console.warn(
                `[runtime:${agent.slug}] onBiome error for ${m.rootHash.slice(0, 12)}…:`,
                (err as Error).message,
              );
            }
          }
          if (head > since) lastBiomeBlock.set(biomeName, head);
        }
      }
    } catch (err) {
      console.warn(
        `[runtime:${agent.slug}] tick error:`,
        (err as Error).message,
      );
    } finally {
      if (!stopped) {
        const wait = interval + Math.floor(Math.random() * jitter);
        setTimeout(tick, wait);
      }
    }
  }

  // First tick on a small delay to let all runtimes finish booting in parallel
  setTimeout(tick, 1000 + Math.floor(Math.random() * jitter));

  return () => {
    stopped = true;
    console.log(`[runtime:${agent.slug}] stopped`);
  };
}
