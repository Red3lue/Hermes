import "dotenv/config";
import { resolveAgent, resolveEnsRecord } from "../packages/sdk/src/ens";
import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

const client = createPublicClient({
  chain: sepolia,
  transport: http(),
});

async function main() {
  //   const ensRecord = await resolveEnsRecord("test.hermes.eth", "hermes.pubkey");
  //   console.log(ensRecord);

  const agentRecords = await resolveAgent("test.hermes.eth", client);
  console.log(agentRecords);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
