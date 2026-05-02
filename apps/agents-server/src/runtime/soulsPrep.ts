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
import { namehash, type Address } from "viem";
import { ANIMA_TEXT_KEY, ANIMUS_TEXT_KEY } from "@hermes/sdk";
import { getPublicClient, makeWalletClient } from "../chain.js";
import { loadKeystoreFile } from "./keystorePrep.js";
import type { AgentDef } from "../registry.js";

const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAME_WRAPPER_SEPOLIA: Address =
  "0x0635513f179D50A207757E05759CbD106d7dFcE8";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
const NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

/** Resolve the effective on-chain owner of an ENS name, transparently
 * unwrapping NameWrapper-wrapped subnames. Returns 0x0 if not registered. */
async function effectiveOwner(name: string): Promise<Address> {
  const publicClient = getPublicClient();
  const node = namehash(name);
  const registryOwner = (await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as Address;
  if (registryOwner.toLowerCase() !== NAME_WRAPPER_SEPOLIA.toLowerCase()) {
    return registryOwner;
  }
  try {
    return (await publicClient.readContract({
      address: NAME_WRAPPER_SEPOLIA,
      abi: NAME_WRAPPER_ABI,
      functionName: "ownerOf",
      args: [BigInt(node)],
    })) as Address;
  } catch {
    return "0x0000000000000000000000000000000000000000";
  }
}

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

  // Anima is encrypted with the agent's own X25519 keypair (self-box).
  // Only the runtime — which has the keystore — can decrypt for LLM
  // context; the deployer-as-owner can also decrypt by reading the same
  // keystore. Everyone else sees ciphertext.
  const ks = loadKeystoreFile(agent.slug);

  const { root } = await buildAnima(
    {
      ens: agent.ens,
      content,
      ownerPubkey: ks.x25519.publicKey,
      ownerSecretKey: ks.x25519.secretKey,
      storage,
    },
    wallet,
  );
  await setAnimaRecord(agent.ens, root, publicClient, wallet);
  console.log(`[souls] published anima for ${agent.slug}: ${root.slice(0, 12)}…`);
}

/** If the biome doesn't yet have a `biome.animus` ENS text record, build
 * one from `agents/_quorum/animus.md` (if present), encrypt with K,
 * upload to 0G, and set the record. Skips if already set, if the source
 * file doesn't exist, or if the deployer wallet doesn't own the biome
 * subname (the demo flow lets users own biomes; in that case the user
 * must publish the Animus from the FE dashboard themselves). */
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

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY!;
  const wallet = makeWalletClient(deployerKey);

  // Pre-flight: who owns the biome subname on chain? If the deployer
  // doesn't own it, ENS setText would revert and we'd surface a confusing
  // multicall error. Bail out cleanly with a hint pointing at the FE
  // owner-side flow instead.
  const owner = await effectiveOwner(biomeName);
  const deployerAddr = wallet.account.address.toLowerCase();
  if (owner.toLowerCase() !== deployerAddr) {
    console.log(
      `[souls] biome ${biomeName} is owned by ${owner} (deployer is ${wallet.account.address}). ` +
        `Skipping animus auto-publish — the biome owner must publish from the FE dashboard ` +
        `(/biomes/${encodeURIComponent(biomeName)} → Animus panel).`,
    );
    return;
  }

  const content = readFileSync(animusFile, "utf8");
  const storage = new ZeroGStorage({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    indexerUrl: process.env.ZEROG_INDEXER_URL!,
    privateKey: (deployerKey.startsWith("0x")
      ? deployerKey
      : `0x${deployerKey}`) as `0x${string}`,
  });

  // Need K for this biome — derive via joinBiome as the owner agent.
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
