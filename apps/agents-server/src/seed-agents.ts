import * as dotenv from "dotenv";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFileSync, writeFileSync } from "node:fs";

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
  namehash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { createSubname } from "@ensdomains/ensjs/wallet";
import {
  generateKeyPairFromSignature,
  resolveAgent,
  setAgentRecords,
} from "hermes-agents-sdk";

type SeedAgent = {
  slug: string;
  ens: string;
  owner: Address;
  address: Address;
  pubkey: string;
  version: number;
};

const DEFAULT_INBOX_CONTRACT = "0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8";
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

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

const optional = (name: string): string | undefined => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : undefined;
};

const normalizeKey = (raw: string): `0x${string}` =>
  (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;

const asAddress = (raw: string, label: string): Address => {
  if (!raw.startsWith("0x") || raw.length !== 42) {
    throw new Error(`Invalid ${label} address: ${raw}`);
  }
  return raw as Address;
};

const ensChain = addEnsContracts(sepolia);
const rpcUrl = required("SEPOLIA_RPC_URL");
const deployer = privateKeyToAccount(
  normalizeKey(required("DEPLOYER_PRIVATE_KEY")),
);
const publicClient = createPublicClient({
  chain: ensChain,
  transport: http(rpcUrl),
});
const wallet = createWalletClient({
  account: deployer,
  chain: ensChain,
  transport: http(rpcUrl),
});

const inboxContract = asAddress(
  optional("HERMES_INBOX_CONTRACT") ?? DEFAULT_INBOX_CONTRACT,
  "HERMES_INBOX_CONTRACT",
);
const parentEns = optional("HERMES_PARENT_ENS") ?? "hermes.eth";

// Agents are registered under hermes.eth (or under a sub-namespace like
// experts.hermes.eth). The ordering matters: `version` is the seed
// passed to generateKeyPairFromSignature so the X25519 keypair is
// deterministic across runs. Do NOT reorder existing entries; only
// append new ones.
const agents: Array<{ slug: string; ens: string }> = [
  { slug: "concierge", ens: "concierge.hermes.eth" },
  { slug: "architect", ens: "architect.hermes.eth" },
  { slug: "auditor", ens: "auditor.hermes.eth" },
  { slug: "pragmatist", ens: "pragmatist.hermes.eth" },
  { slug: "skeptic", ens: "skeptic.hermes.eth" },
  { slug: "futurist", ens: "futurist.hermes.eth" },
  { slug: "coordinator", ens: "coordinator.hermes.eth" },
  { slug: "reporter", ens: "reporter.hermes.eth" },
  // Selector demo (Anima-driven routing). The experts live under a
  // dedicated sub-parent `experts.hermes.eth`; the seed script mints
  // that parent first (see ensureExpertsParent) before minting the
  // three child subnames.
  { slug: "selector", ens: "selector.hermes.eth" },
  { slug: "tech-expert", ens: "tech.experts.hermes.eth" },
  { slug: "legal-expert", ens: "legal.experts.hermes.eth" },
  { slug: "product-expert", ens: "product.experts.hermes.eth" },
];

// ENS sub-parent for the expert agents. Minted as a NameWrapper
// subname owned by the deployer so that further subnames
// (`<role>.experts.hermes.eth`) can be created under it.
const EXPERTS_PARENT_ENS = "experts.hermes.eth";

const AGENTS_DIR =
  process.env.AGENTS_DIR ??
  resolve(fileURLToPath(new URL(".", import.meta.url)), "../../web/agents");

function agentJsonPath(slug: string): string {
  return join(AGENTS_DIR, slug, "agent.json");
}

function readAgentJson(slug: string): Record<string, unknown> {
  return JSON.parse(readFileSync(agentJsonPath(slug), "utf8"));
}

function writeAgentJson(slug: string, data: Record<string, unknown>): void {
  writeFileSync(agentJsonPath(slug), JSON.stringify(data, null, 2) + "\n");
}

async function ensOwner(name: string): Promise<Address> {
  return (await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [namehash(name)],
  })) as Address;
}

async function subnameExists(name: string): Promise<boolean> {
  const owner = await ensOwner(name);
  return owner !== "0x0000000000000000000000000000000000000000";
}

/** Idempotent: ensure `experts.hermes.eth` is minted as a NameWrapper
 * subname owned by the deployer, so we can mint
 * `<role>.experts.hermes.eth` children under it. Called once before any
 * expert agent is seeded. */
async function ensureExpertsParent(): Promise<void> {
  if (await subnameExists(EXPERTS_PARENT_ENS)) {
    console.log(`[seed] parent ${EXPERTS_PARENT_ENS} already minted`);
    return;
  }
  console.log(`[seed] minting parent ${EXPERTS_PARENT_ENS}`);
  try {
    const tx = await createSubname(wallet, {
      name: EXPERTS_PARENT_ENS,
      contract: "nameWrapper",
      owner: deployer.address,
    });
    console.log(`  parent tx = ${tx}`);
    await publicClient.waitForTransactionReceipt({ hash: tx });
  } catch (err) {
    console.warn(
      `[seed] could not mint ${EXPERTS_PARENT_ENS}: ${(err as Error).message.split("\n")[0]}`,
    );
    console.warn(
      `       Mint manually in app.ens.domains under hermes.eth, owner = deployer, then re-run.`,
    );
    throw err;
  }
}

async function recordsAlreadyMatch(
  agent: SeedAgent,
): Promise<boolean> {
  try {
    const r = await resolveAgent(agent.ens, publicClient);
    return (
      r.addr.toLowerCase() === agent.address.toLowerCase() &&
      r.pubkey === agent.pubkey &&
      r.inbox.toLowerCase() === inboxContract.toLowerCase()
    );
  } catch {
    return false;
  }
}

async function seedAgent(agent: SeedAgent) {
  console.log(`\n[seed] ${agent.ens}`);
  console.log(`  owner   = ${agent.owner}`);
  console.log(`  address = ${agent.address}`);
  console.log(`  pubkey  = ${agent.pubkey}`);

  // Idempotent subname mint
  if (await subnameExists(agent.ens)) {
    console.log(`  subname = already exists, skipping mint`);
  } else {
    try {
      const subnameTx = await createSubname(wallet, {
        name: agent.ens,
        contract: "nameWrapper",
        owner: agent.owner,
      });
      console.log(`  subname tx = ${subnameTx}`);
      await publicClient.waitForTransactionReceipt({ hash: subnameTx });
    } catch (err) {
      console.log(
        `  subname mint failed: ${(err as Error).message.split("\n")[0]}`,
      );
      console.log(
        `  → mint ${agent.ens} manually in the ENS dashboard, then re-run.`,
      );
      return;
    }
  }

  // Idempotent records set
  if (await recordsAlreadyMatch(agent)) {
    console.log(`  records = already correct, skipping setText`);
  } else {
    const recordTx = await setAgentRecords(
      agent.ens,
      {
        addr: agent.address,
        pubkey: agent.pubkey,
        inbox: inboxContract,
      },
      publicClient,
      wallet,
    );
    console.log(`  record tx = ${recordTx}`);
  }

  const resolved = await resolveAgent(agent.ens, publicClient);
  console.log(
    `  verified  = ${resolved.addr} | ${resolved.pubkey.slice(0, 24)}… | ${resolved.inbox}`,
  );

  // Persist into agent.json so the runtime + FE can discover values
  // without re-deriving / re-querying.
  const json = readAgentJson(agent.slug);
  json.address = agent.address;
  json.x25519PubKey = agent.pubkey;
  json.x25519Version = agent.version;
  json.ensSubnameRegistered = true;
  writeAgentJson(agent.slug, json);
  console.log(`  agent.json updated`);
}

async function main() {
  console.log(`[seed] deployer = ${deployer.address}`);
  console.log(`[seed] parent   = ${parentEns}`);
  console.log(`[seed] inbox    = ${inboxContract}`);
  console.log(
    `[seed] ${agents.length} agents share the deployer wallet (addr ENS record);`,
  );
  console.log(`       each derives a unique X25519 keypair via versioned sig.`);
  console.log(`[seed] alice/bob/carlos are exempt from this script`);

  // Ensure the experts.hermes.eth sub-parent exists before any
  // *.experts.hermes.eth child is minted.
  if (agents.some((a) => a.ens.endsWith(`.${EXPERTS_PARENT_ENS}`))) {
    await ensureExpertsParent();
  }

  const seedAgents: SeedAgent[] = agents.map(({ slug, ens }, idx) => ({
    slug,
    ens,
    owner: deployer.address,
    address: deployer.address,
    pubkey: undefined as never,
    version: idx + 1,
  }));

  for (const agent of seedAgents) {
    const keyPair = await generateKeyPairFromSignature(wallet, agent.version);
    agent.pubkey = keyPair.publicKey;

    await seedAgent(agent);
  }

  console.log("\n[seed] done");
  console.log("\nNext steps:");
  console.log(
    "  1. If any subname mint failed, create it in app.ens.domains/<parent>",
  );
  console.log("     → wrap as a NameWrapper subname, owner = deployer.");
  console.log("  2. Re-run `pnpm seed-agents` until every agent says");
  console.log('     `subname = already exists` and `records = already correct`.');
  console.log(
    "  3. Then proceed to `pnpm publish-biome` (next phase) to update the",
  );
  console.log("     BiomeDoc with the 7 quorum members + symKey.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
