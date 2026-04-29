import "dotenv/config";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { transferName } from "@ensdomains/ensjs/wallet";

const norm = (k: string): `0x${string}` =>
  (k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`;

const ensChain = addEnsContracts(sepolia);
const deployer = privateKeyToAccount(norm(process.env.DEPLOYER_PRIVATE_KEY!));
const aliceAddr = privateKeyToAccount(norm(process.env.HERMES_ALICE_PRIVATE_KEY!)).address;
const bobAddr = privateKeyToAccount(norm(process.env.HERMES_BOB_PRIVATE_KEY!)).address;

const wallet = createWalletClient({
  account: deployer,
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function main() {
  console.log(`transferring ${process.env.HERMES_ALICE_ENS} → ${aliceAddr}`);
  const tx1 = await transferName(wallet, {
    name: process.env.HERMES_ALICE_ENS!,
    newOwnerAddress: aliceAddr,
    contract: "registry",
    account: deployer,
  });
  console.log("  tx:", tx1);

  console.log(`transferring ${process.env.HERMES_BOB_ENS} → ${bobAddr}`);
  const tx2 = await transferName(wallet, {
    name: process.env.HERMES_BOB_ENS!,
    newOwnerAddress: bobAddr,
    contract: "registry",
    account: deployer,
  });
  console.log("  tx:", tx2);

  console.log("✓ transfers submitted; verify with check-ens-ownership.ts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
