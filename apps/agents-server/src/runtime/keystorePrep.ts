import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  generateKeyPairFromSignature,
  saveKeystore,
  type Keystore,
} from "hermes-agents-sdk";
import { makeWalletClient } from "../chain.js";
import type { AgentDef } from "../registry.js";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// Per-agent keystore files live next to the source so dev/test reuse them
// across reboots without re-deriving (which is cheap, but spares wallet work).
// Containerised builds set HERMES_RUNTIME_DIR to a writable path (e.g.
// /app/.hermes-runtime) since the in-source path doesn't exist after
// `pnpm deploy`.
const KEYSTORE_DIR =
  process.env.HERMES_RUNTIME_DIR ?? resolve(__dirname, "../../.hermes-runtime");

function keystorePath(slug: string): string {
  return join(KEYSTORE_DIR, `${slug}.json`);
}

/**
 * Ensure a keystore file exists for the given agent. The X25519 keypair is
 * deterministic from (deployer wallet sig, agent.x25519Version), so this is
 * fully reproducible: deleting the keystore and re-running yields identical
 * keys.
 */
export async function ensureAgentKeystore(agent: AgentDef): Promise<string> {
  if (!existsSync(KEYSTORE_DIR)) mkdirSync(KEYSTORE_DIR, { recursive: true });
  const path = keystorePath(agent.slug);
  if (existsSync(path)) return path;

  const deployerKey = process.env.DEPLOYER_PRIVATE_KEY;
  if (!deployerKey) throw new Error("DEPLOYER_PRIVATE_KEY required");

  const wallet = makeWalletClient(deployerKey);
  const keys = await generateKeyPairFromSignature(wallet, agent.x25519Version);

  // Sanity check: derived pubkey must match what was published to ENS.
  if (keys.publicKey !== agent.x25519PubKey) {
    throw new Error(
      `derived pubkey for ${agent.slug} (${keys.publicKey}) does not match agent.json (${agent.x25519PubKey}). ` +
        `Re-run pnpm seed-agents and regenerate.`,
    );
  }

  const ks: Keystore = {
    ensName: agent.ens,
    address: wallet.account.address,
    keyVersion: agent.x25519Version,
    x25519: keys,
  };
  saveKeystore(path, ks);
  return path;
}

export function readKeystorePath(slug: string): string {
  return keystorePath(slug);
}

export function loadKeystoreFile(slug: string): Keystore {
  return JSON.parse(readFileSync(keystorePath(slug), "utf8")) as Keystore;
}
