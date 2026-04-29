import "dotenv/config";
import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { getOwner } from "@ensdomains/ensjs/public";
import { privateKeyToAccount } from "viem/accounts";

const ensChain = addEnsContracts(sepolia);
const client = createPublicClient({
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const names = [
  process.env.HERMES_ALICE_ENS!,
  process.env.HERMES_BOB_ENS!,
  "hermes.eth",
];
const wallets = {
  alice: privateKeyToAccount(
    (process.env.HERMES_ALICE_PRIVATE_KEY!.startsWith("0x")
      ? process.env.HERMES_ALICE_PRIVATE_KEY!
      : `0x${process.env.HERMES_ALICE_PRIVATE_KEY!}`) as `0x${string}`,
  ).address,
  bob: privateKeyToAccount(
    (process.env.HERMES_BOB_PRIVATE_KEY!.startsWith("0x")
      ? process.env.HERMES_BOB_PRIVATE_KEY!
      : `0x${process.env.HERMES_BOB_PRIVATE_KEY!}`) as `0x${string}`,
  ).address,
  deployer: privateKeyToAccount(
    (process.env.DEPLOYER_PRIVATE_KEY!.startsWith("0x")
      ? process.env.DEPLOYER_PRIVATE_KEY!
      : `0x${process.env.DEPLOYER_PRIVATE_KEY!}`) as `0x${string}`,
  ).address,
};

async function main() {
  console.log("Wallets:");
  console.log("  alice    =", wallets.alice);
  console.log("  bob      =", wallets.bob);
  console.log("  deployer =", wallets.deployer);
  console.log();

  for (const name of names) {
    try {
      const ownerInfo = await getOwner(client, { name });
      console.log(`${name}:`);
      console.log("  namehash:", namehash(name));
      console.log("  ownership:", ownerInfo);
    } catch (e) {
      console.log(`${name}: ERROR`, (e as Error).message);
    }
    console.log();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
