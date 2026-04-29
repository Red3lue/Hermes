import "dotenv/config";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { Hermes } from "../packages/sdk/src";

const ALICE_ENS = process.env.HERMES_ALICE_ENS!;
const BOB_ENS = process.env.HERMES_BOB_ENS!;
const ALICE_PK = normalizePk(process.env.HERMES_ALICE_PRIVATE_KEY!);
const BOB_PK = normalizePk(process.env.HERMES_BOB_PRIVATE_KEY!);
const ZEROG_PK = normalizePk(process.env.DEPLOYER_PRIVATE_KEY!);

const ensChain = addEnsContracts(sepolia);
const publicClient = createPublicClient({
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const inboxContract = process.env.HERMES_INBOX_CONTRACT! as `0x${string}`;

function normalizePk(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

function makeAgent(ensName: string, pk: `0x${string}`, keystoreFile: string) {
  const account = privateKeyToAccount(pk);
  const wallet = createWalletClient({
    account,
    chain: ensChain,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });
  return new Hermes({
    ensName,
    inboxContract,
    publicClient,
    wallet,
    storage: {
      rpcUrl: process.env.ZEROG_RPC_URL!,
      indexerUrl: process.env.ZEROG_INDEXER_URL!,
      privateKey: ZEROG_PK, // 0G uploads paid by deployer; tx auth is offchain
    },
    keystorePath: keystoreFile,
  });
}

async function main() {
  const alice = makeAgent(ALICE_ENS, ALICE_PK, ".hermes/alice.json");
  const bob = makeAgent(BOB_ENS, BOB_PK, ".hermes/bob.json");

  console.log("registering alice + bob...");
  await alice.register();
  await bob.register();

  const startBlock = await publicClient.getBlockNumber();
  const text = `hello from alice @ ${Date.now()}`;

  console.log(`alice → bob: "${text}"`);
  const sent = await alice.send(BOB_ENS, text);
  console.log("  rootHash:", sent.rootHash, "tx:", sent.tx);

  console.log("waiting 8s for log indexing...");
  await new Promise((r) => setTimeout(r, 8000));

  const inbox = await bob.fetchInbox(startBlock);
  console.log("bob inbox:", inbox);

  const got = inbox.find((m) => m.rootHash === sent.rootHash);
  if (!got) throw new Error("message not found in bob's inbox");
  if (got.text !== text) throw new Error(`mismatch: got "${got.text}"`);
  if (got.from !== ALICE_ENS) throw new Error(`wrong sender: ${got.from}`);

  console.log("✓ end-to-end OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
