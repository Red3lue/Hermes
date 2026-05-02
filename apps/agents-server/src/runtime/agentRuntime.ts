import {
  Hermes,
  type ReceivedMessage,
  type BiomeReceivedMessage,
} from "@hermes/sdk";
import { getPublicClient, makeWalletClient } from "../chain.js";
import type { AgentDef } from "../registry.js";
import { ensureAgentKeystore } from "./keystorePrep.js";

export type RuntimeContext = {
  agent: AgentDef;
  hermes: Hermes;
  // Convenience helpers
  sendDM: (toEns: string, body: string) => Promise<{ rootHash: `0x${string}` }>;
  broadcast: (
    biomeName: string,
    body: string,
  ) => Promise<{ rootHash: `0x${string}` }>;
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

  const ctx: RuntimeContext = {
    agent,
    hermes,
    sendDM: async (toEns, body) =>
      withRetry(`sendDM→${toEns}`, async () => {
        const r = await hermes.send(toEns, body);
        return { rootHash: r.rootHash };
      }),
    broadcast: async (biomeName, body) =>
      withRetry(`broadcast→${biomeName}`, async () => {
        const r = await hermes.sendToBiome(biomeName, body);
        return { rootHash: r.rootHash };
      }),
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
