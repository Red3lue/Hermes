import { createPublicClient, http, namehash } from "viem";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { getEnsResolver } from "viem/ens";
import { config as loadEnv } from "dotenv";
loadEnv({ path: "/home/lorenzo/Desktop/hackathon/openAgents/Hermes/.env" });

const REGISTRY_ABI = [{
  type:"function", name:"owner", stateMutability:"view",
  inputs:[{name:"node",type:"bytes32"}], outputs:[{name:"",type:"address"}]
}] as const;

const client = createPublicClient({ chain: addEnsContracts(sepolia), transport: http(process.env.SEPOLIA_RPC_URL) });
const REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";

for (const [who, name, addr] of [
  ["alice","alice.hermes.eth","0x1032e2f6E9f3C8Af462612D2FD230b354A6C7d3e"],
  ["bob",  "bob.hermes.eth",  "0x9FEfD22a316A98269284ED94d56Fb941Ec5f9Caf"],
  ["carol","carol.hermes.eth","0x915d8317fEAa09b22ba025FcD7C8E340ad4c9445"],
] as const) {
  const node = namehash(name);
  const owner = await client.readContract({ address: REGISTRY as `0x${string}`, abi: REGISTRY_ABI, functionName: "owner", args: [node] });
  const resolver = await getEnsResolver(client, { name }).catch(() => null);
  console.log(`${who} ${name} owner=${owner} resolver=${resolver} ownerMatches=${(owner as string).toLowerCase()===addr.toLowerCase()}`);
}
