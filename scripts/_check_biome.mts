import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/home/lorenzo/Desktop/hackathon/openAgents/Hermes/.env" });

const REGISTRY_ABI = [{
  type:"function", name:"owner", stateMutability:"view",
  inputs:[{name:"node",type:"bytes32"}], outputs:[{name:"",type:"address"}]
}] as const;
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const client = createPublicClient({ chain: addEnsContracts(sepolia), transport: http(process.env.SEPOLIA_RPC_URL) });

for (const name of ["hermes.eth", "demo.hermes.eth", "carlos.hermes.eth"]) {
  const owner = await client.readContract({
    address: REGISTRY as `0x${string}`,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [namehash(name)],
  });
  console.log(`${name} owner = ${owner}`);
}
console.log(`alice = 0x1032e2f6E9f3C8Af462612D2FD230b354A6C7d3e`);
