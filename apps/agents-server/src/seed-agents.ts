import * as dotenv from "dotenv";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

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
import { createSubname } from "@ensdomains/ensjs/wallet";
import {
  generateKeyPairFromSignature,
  resolveAgent,
  setAgentRecords,
} from "@hermes/sdk";

type SeedAgent = {
  slug: string;
  ens: string;
  owner: Address;
  address: Address;
  pubkey: string;
  version: number;
};

const DEFAULT_INBOX_CONTRACT = "0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8";

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

const agentEnv = (slug: string) => slug.toUpperCase();

const resolveTargetAddress = (slug: string): Address => {
  const upper = agentEnv(slug);
  const explicitAddress = optional(`HERMES_${upper}_ADDRESS`);
  if (explicitAddress) {
    return asAddress(explicitAddress, `HERMES_${upper}_ADDRESS`);
  }

  return deployer.address;
};

const agents: Array<{ slug: string; ens: string }> = [
  { slug: "concierge", ens: "concierge.hermes.eth" },
  { slug: "architect", ens: "architect.hermes.eth" },
  { slug: "auditor", ens: "auditor.hermes.eth" },
  { slug: "pragmatist", ens: "pragmatist.hermes.eth" },
  { slug: "skeptic", ens: "skeptic.hermes.eth" },
  { slug: "futurist", ens: "futurist.hermes.eth" },
];

async function seedAgent(agent: SeedAgent) {
  console.log(`\n[seed] ${agent.ens}`);
  console.log(`  owner   = ${agent.owner}`);
  console.log(`  address = ${agent.address}`);

  const subnameTx = await createSubname(wallet, {
    name: agent.ens,
    contract: "nameWrapper",
    owner: agent.owner,
  });
  console.log(`  subname tx = ${subnameTx}`);
  await publicClient.waitForTransactionReceipt({ hash: subnameTx });

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

  const resolved = await resolveAgent(agent.ens, publicClient);
  console.log(
    `  verified  = ${resolved.addr} | ${resolved.pubkey.slice(0, 24)}… | ${resolved.inbox}`,
  );
}

async function main() {
  console.log(`[seed] deployer = ${deployer.address}`);
  console.log(`[seed] parent   = ${parentEns}`);
  console.log(`[seed] inbox    = ${inboxContract}`);
  console.log("[seed] alice/bob/carlos are exempt from this script");

  const seedAgents: SeedAgent[] = agents.map(({ slug, ens }) => ({
    slug,
    ens,
    owner: deployer.address,
    address: deployer.address,
    pubkey: undefined as never,
    version: agents.findIndex((agent) => agent.slug === slug) + 1,
  }));

  for (const agent of seedAgents) {
    const keyPair = await generateKeyPairFromSignature(wallet, agent.version);
    agent.pubkey = keyPair.publicKey;

    await seedAgent(agent);
  }

  console.log("\n[seed] done");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
