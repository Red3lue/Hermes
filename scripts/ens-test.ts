import "dotenv/config";
import { resolveAgent, setAgentRecords } from "../packages/sdk/src/ens";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";

const rawKey = process.env.DEPLOYER_PRIVATE_KEY!;
const account = privateKeyToAccount(
  (rawKey.startsWith("0x") ? rawKey : `0x${rawKey}`) as `0x${string}`,
);

const ensChain = addEnsContracts(sepolia);

const publicClient = createPublicClient({
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

const walletClient = createWalletClient({
  account,
  chain: ensChain,
  transport: http(process.env.SEPOLIA_RPC_URL),
});

async function main() {
  console.log("Setting agent records...");
  const hash = await setAgentRecords(
    "test.hermes.eth",
    {
      addr: "0x1234567890123456789012345678901234567890",
      pubkey:
        "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef",
      inbox: "https://example.com/inbox",
    },
    publicClient,
    walletClient,
  );
  console.log("Agent records set. tx:", hash);

  console.log("Resolving agent records...");
  const agentRecords = await resolveAgent("test.hermes.eth", publicClient);
  console.log(agentRecords);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
