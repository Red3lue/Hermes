import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { Hermes, type HermesConfig } from "hermes-agents-sdk";

const ensChain = addEnsContracts(sepolia);

function pk(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

export function makeHermes(opts: {
  ensName: string;
  privateKey: string;
  keystorePath: string;
}): { hermes: Hermes; getBlock: () => Promise<bigint> } {
  const account = privateKeyToAccount(pk(opts.privateKey));
  const publicClient = createPublicClient({
    chain: ensChain,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });
  const wallet = createWalletClient({
    account,
    chain: ensChain,
    transport: http(process.env.SEPOLIA_RPC_URL),
  });
  const cfg: HermesConfig = {
    ensName: opts.ensName,
    inboxContract: process.env.HERMES_INBOX_CONTRACT! as `0x${string}`,
    publicClient,
    wallet,
    storage: {
      rpcUrl: process.env.ZEROG_RPC_URL!,
      indexerUrl: process.env.ZEROG_INDEXER_URL!,
      privateKey: pk(process.env.DEPLOYER_PRIVATE_KEY!), // 0G uploads paid by deployer
    },
    keystorePath: opts.keystorePath,
  };
  return {
    hermes: new Hermes(cfg),
    getBlock: () => publicClient.getBlockNumber(),
  };
}
