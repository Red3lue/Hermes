import * as dotenv from "dotenv";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync, readFileSync, statSync } from "node:fs";

const envPath = resolve(
  fileURLToPath(new URL(".", import.meta.url)),
  "../../../.env",
);
const envResult = dotenv.config({ path: envPath });
if (envResult.error) {
  throw new Error(
    `Failed to load Hermes root .env from ${envPath}: ${envResult.error.message}`,
  );
}

import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import {
  ZeroGStorage,
  generateKeyPairFromSignature,
  resolveAgent,
  setAgentRecords,
  createBiome,
  resolveBiomeRecords,
  type BiomeMember,
} from "hermes-agents-sdk";

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};
const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};
const norm = (raw: string): `0x${string}` =>
  (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
const asAddress = (raw: string, label: string): Address => {
  if (!raw.startsWith("0x") || raw.length !== 42) {
    throw new Error(`Invalid ${label}: ${raw}`);
  }
  return raw as Address;
};

const DEFAULT_INBOX = "0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8";

const ensChain = addEnsContracts(sepolia);
const rpcUrl = required("SEPOLIA_RPC_URL");
const inboxContract = asAddress(
  optional("HERMES_INBOX_CONTRACT") ?? DEFAULT_INBOX,
  "HERMES_INBOX_CONTRACT",
);
const biomeName =
  optional("HERMES_BIOME_ENS") ?? "quorumv2.biomes.hermes.eth";
const aliceEns = optional("HERMES_ALICE_ENS") ?? "alice.hermes.eth";

const publicClient = createPublicClient({
  chain: ensChain,
  transport: http(rpcUrl),
});

const aliceWallet = createWalletClient({
  account: privateKeyToAccount(norm(required("HERMES_ALICE_PRIVATE_KEY"))),
  chain: ensChain,
  transport: http(rpcUrl),
});
const deployerWallet = createWalletClient({
  account: privateKeyToAccount(norm(required("DEPLOYER_PRIVATE_KEY"))),
  chain: ensChain,
  transport: http(rpcUrl),
});

const AGENTS_DIR =
  process.env.AGENTS_DIR ??
  resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/agents");

type AgentJson = {
  ens: string;
  address: string;
  roles: string[];
  x25519PubKey: string;
  x25519Version: number;
};

function loadAgentJson(slug: string): AgentJson {
  return JSON.parse(
    readFileSync(join(AGENTS_DIR, slug, "agent.json"), "utf8"),
  ) as AgentJson;
}

function listAgentSlugs(): string[] {
  return readdirSync(AGENTS_DIR).filter((name) => {
    if (name.startsWith("_")) return false;
    try {
      return statSync(join(AGENTS_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });
}

async function ensureAliceEnsRecords(): Promise<{
  addr: `0x${string}`;
  pubkey: string;
}> {
  // Derive alice's X25519 keypair from her wallet sig (version=1; same
  // version the FE will use so the keys match).
  const kp = await generateKeyPairFromSignature(aliceWallet, 1);
  const aliceAddr = aliceWallet.account!.address;

  // Idempotent: if records already correct, skip.
  try {
    const r = await resolveAgent(aliceEns, publicClient);
    if (
      r.addr.toLowerCase() === aliceAddr.toLowerCase() &&
      r.pubkey === kp.publicKey &&
      r.inbox.toLowerCase() === inboxContract.toLowerCase()
    ) {
      console.log(`[alice] ENS records already correct for ${aliceEns}`);
      return { addr: aliceAddr, pubkey: kp.publicKey };
    }
  } catch {
    // records missing or partial; will set below
  }

  console.log(`[alice] setting ENS records for ${aliceEns}`);
  // Try alice's own wallet first; fall back to deployer if alice doesn't own
  // the resolver authority. Most ENS subnames after transfer are owned by the
  // recipient.
  let tx: `0x${string}`;
  try {
    tx = await setAgentRecords(
      aliceEns,
      { addr: aliceAddr, pubkey: kp.publicKey, inbox: inboxContract },
      publicClient,
      aliceWallet,
    );
    console.log(`  set via alice wallet, tx = ${tx}`);
  } catch (err) {
    console.log(
      `  alice wallet failed (${(err as Error).message.split("\n")[0]}), trying deployer`,
    );
    tx = await setAgentRecords(
      aliceEns,
      { addr: aliceAddr, pubkey: kp.publicKey, inbox: inboxContract },
      publicClient,
      deployerWallet,
    );
    console.log(`  set via deployer wallet, tx = ${tx}`);
  }

  // Confirm
  const verified = await resolveAgent(aliceEns, publicClient);
  console.log(
    `  verified  = ${verified.addr} | ${verified.pubkey.slice(0, 24)}…`,
  );
  return { addr: aliceAddr, pubkey: kp.publicKey };
}

async function buildMembers(): Promise<BiomeMember[]> {
  const slugs = listAgentSlugs();
  const agents = slugs.map(loadAgentJson);
  const members: BiomeMember[] = [];
  for (const a of agents) {
    if (!a.x25519PubKey) {
      console.warn(
        `[publish-biome] skipping ${a.ens} — no x25519PubKey (run pnpm seed-agents first)`,
      );
      continue;
    }
    members.push({ ens: a.ens, pubkey: a.x25519PubKey });
  }
  return members;
}

async function main() {
  console.log(`[publish-biome] biome = ${biomeName}`);
  console.log(`[publish-biome] owner = ${aliceEns}`);

  // 1. Ensure alice has hermes.pubkey on her ENS so members can verify her.
  const aliceRecords = await ensureAliceEnsRecords();

  // 2. Re-derive alice's X25519 keypair (deterministic from sig). Used as
  // the BiomeContext.myKeys so wraps are encrypted with alice's pubkey.
  const aliceKeys = await generateKeyPairFromSignature(aliceWallet, 1);
  if (aliceKeys.publicKey !== aliceRecords.pubkey) {
    throw new Error(
      `derived pubkey mismatch — ENS shows ${aliceRecords.pubkey} but derivation gave ${aliceKeys.publicKey}`,
    );
  }

  // 3. Build member roster: alice (owner) + 7 agent members loaded from disk.
  const agentMembers = await buildMembers();
  const members: BiomeMember[] = [
    { ens: aliceEns, pubkey: aliceKeys.publicKey },
    ...agentMembers,
  ];
  console.log(
    `[publish-biome] members (${members.length}):\n` +
      members.map((m) => `  - ${m.ens}`).join("\n"),
  );

  // 4. Existing biome doc?
  try {
    const existing = await resolveBiomeRecords(biomeName, publicClient);
    console.log(
      `[publish-biome] existing biome.root = ${existing.root}, version = ${existing.version} — will be overwritten`,
    );
  } catch {
    console.log("[publish-biome] no existing biome.root, fresh publish");
  }

  // 5. Build + sign + upload + setBiomeRecords via SDK. createBiome uses
  // alice's wallet to sign the doc + setText. setText will fail if alice
  // does not own the resolver record on quorumv2.biomes.hermes.eth — in that
  // case ensure alice owns the subname (you confirmed she does).
  const storage = new ZeroGStorage({
    rpcUrl: required("ZEROG_RPC_URL"),
    indexerUrl: required("ZEROG_INDEXER_URL"),
    privateKey: norm(required("DEPLOYER_PRIVATE_KEY")),
  });

  const result = await createBiome(
    {
      publicClient,
      wallet: aliceWallet as never,
      storage,
      myEns: aliceEns,
      myKeys: aliceKeys,
    },
    {
      name: biomeName,
      goal:
        "Decide proposals submitted by the biome owner using a coordinated quorum of LLM agents. Reports are broadcast to the biome inbox.",
      rules: { roundTimeoutSec: 90, requiredVerdicts: 5 },
      members,
    },
  );

  console.log("\n[publish-biome] published BiomeDoc");
  console.log(`  root    = ${result.root}`);
  console.log(`  version = ${result.version}`);
  console.log(`  members = ${result.doc.members.length}`);
  console.log(`  wraps   = ${Object.keys(result.doc.wraps).length}`);
  console.log("\nNext: run the relayer (Phase 2) to start polling.");
}

main().catch((err) => {
  console.error("[publish-biome] failed:", err);
  process.exit(1);
});
