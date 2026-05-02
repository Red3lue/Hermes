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

  const ctx: RuntimeContext = {
    agent,
    hermes,
    sendDM: async (toEns, body) => {
      const r = await hermes.send(toEns, body);
      return { rootHash: r.rootHash };
    },
    broadcast: async (biomeName, body) => {
      const r = await hermes.sendToBiome(biomeName, body);
      return { rootHash: r.rootHash };
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
      // 1. Fetch DMs since lastDmBlock
      if (handler.onDM) {
        const msgs = await hermes.fetchInbox(lastDmBlock);
        for (const m of msgs) {
          if (seenRoots.has(m.rootHash)) continue;
          seenRoots.add(m.rootHash);
          if (m.blockNumber > lastDmBlock) lastDmBlock = m.blockNumber;
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
      }

      // 2. Fetch biome broadcasts for each subscribed biome
      if (handler.onBiome) {
        for (const biomeName of handler.subscribedBiomes) {
          const since = lastBiomeBlock.get(biomeName) ?? 0n;
          const msgs = await hermes.fetchBiomeInbox(biomeName, since);
          for (const m of msgs) {
            if (seenRoots.has(m.rootHash)) continue;
            seenRoots.add(m.rootHash);
            if (m.blockNumber > since)
              lastBiomeBlock.set(biomeName, m.blockNumber);
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
