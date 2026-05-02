import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildAnima,
  buildAnimus,
  setAnimaRecord,
  setAnimusRecord,
  ZeroGStorage,
  joinBiome,
  type Hermes,
} from "@hermes/sdk";
import { getEnsText, normalize } from "viem/ens";
import { ANIMA_TEXT_KEY, ANIMUS_TEXT_KEY } from "@hermes/sdk";
import { getPublicClient, makeWalletClient } from "../chain.js";
import { loadKeystoreFile } from "./keystorePrep.js";
import type { AgentDef } from "../registry.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const AGENTS_DIR = resolve(__dirname, "../../../web/agents");

/** If the agent doesn't yet have a `hermes.anima` ENS text record, build
 * one from `agents/<slug>/anima.md` (or fall back to `persona.md`),
 * upload to 0G, and set the record. Idempotent: skips if already set. */
export async function ensureAgentAnima(agent: AgentDef): Promise<void> {
  const publicClient = getPublicClient();
  const existing = await getEnsText(publicClient, {
    name: normalize(agent.ens),
    key: ANIMA_TEXT_KEY,
  });
  if (existing) {
    console.log(`[souls] anima already published for ${agent.slug}: ${existing.slice(0, 12)}…`);
    return;
  }

  const animaFile = resolve(AGENTS_DIR, agent.slug, "anima.md");
  const personaFile = resolve(AGENTS_DIR, agent.slug, "persona.md");
  const sourcePath = existsSync(animaFile) ? animaFile : personaFile;
  const content = readFileSync(sourcePath, "utf8");

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const wallet = makeWalletClient(deployerKey);
  const storage = new ZeroGStorage({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    indexerUrl: process.env.ZEROG_INDEXER_URL!,
    privateKey: (deployerKey.startsWith("0x")
      ? deployerKey
      : `0x${deployerKey}`) as `0x${string}`,
  });

  const { root } = await buildAnima(
    { ens: agent.ens, content, storage },
    wallet,
  );
  await setAnimaRecord(agent.ens, root, publicClient, wallet);
  console.log(`[souls] published anima for ${agent.slug}: ${root.slice(0, 12)}…`);
}

/** If the biome doesn't yet have a `biome.animus` ENS text record, build
 * one from `agents/_quorum/animus.md` (if present), encrypt with K,
 * upload to 0G, and set the record. Skips if already set or if the source
 * file doesn't exist. */
export async function ensureBiomeAnimus(
  biomeName: string,
  ownerAgent: AgentDef,
): Promise<void> {
  const publicClient = getPublicClient();
  const existing = await getEnsText(publicClient, {
    name: normalize(biomeName),
    key: ANIMUS_TEXT_KEY,
  });
  if (existing) {
    console.log(`[souls] animus already published for ${biomeName}: ${existing.slice(0, 12)}…`);
    return;
  }

  const animusFile = resolve(AGENTS_DIR, "_quorum", "animus.md");
  if (!existsSync(animusFile)) {
    console.log(
      `[souls] no _quorum/animus.md found; skipping animus auto-publish for ${biomeName}`,
    );
    return;
  }
  const content = readFileSync(animusFile, "utf8");

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const wallet = makeWalletClient(deployerKey);
  const storage = new ZeroGStorage({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    indexerUrl: process.env.ZEROG_INDEXER_URL!,
    privateKey: (deployerKey.startsWith("0x")
      ? deployerKey
      : `0x${deployerKey}`) as `0x${string}`,
  });

  // Need K for this biome — derive via joinBiome as the owner.
  const ks = loadKeystoreFile(ownerAgent.slug);
  const { K } = await joinBiome(
    {
      publicClient,
      wallet: wallet as never,
      storage,
      myEns: ownerAgent.ens,
      myKeys: ks.x25519,
    },
    biomeName,
  );

  const { root } = await buildAnimus(
    { biomeName, ownerEns: ownerAgent.ens, content, K, storage },
    wallet,
  );
  await setAnimusRecord(biomeName, root, publicClient, wallet);
  console.log(`[souls] published animus for ${biomeName}: ${root.slice(0, 12)}…`);
}
