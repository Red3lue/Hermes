import {
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  type WalletClient,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { Hermes, type HermesConfig } from "hermes-agents-sdk";

const ensChain = addEnsContracts(sepolia);

function normalizeKey(raw: string): `0x${string}` {
  return (raw.startsWith("0x") ? raw : `0x${raw}`) as `0x${string}`;
}

let _publicClient: PublicClient | null = null;

export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: ensChain,
      transport: http(process.env.SEPOLIA_RPC_URL),
    });
  }
  return _publicClient;
}

export function makeWalletClient(
  privateKey: string,
): WalletClient & { account: Account } {
  const account = privateKeyToAccount(normalizeKey(privateKey));
  return createWalletClient({
    account,
    chain: ensChain,
    transport: http(process.env.SEPOLIA_RPC_URL),
  }) as WalletClient & { account: Account };
}

export function makeHermes(ensName: string, privateKey: string): Hermes {
  const cfg: HermesConfig = {
    ensName,
    inboxContract: process.env.HERMES_INBOX_CONTRACT! as `0x${string}`,
    publicClient: getPublicClient(),
    wallet: makeWalletClient(privateKey),
    storage: {
      rpcUrl: process.env.ZEROG_RPC_URL!,
      indexerUrl: process.env.ZEROG_INDEXER_URL!,
      privateKey: normalizeKey(process.env.DEPLOYER_PRIVATE_KEY!),
    },
  };
  return new Hermes(cfg);
}

/** Parse AGENT_PRIVATE_KEYS env var: "slug:0xkey,slug:0xkey,..." */
export function parseAgentKeys(): Record<string, string> {
  const raw = process.env.AGENT_PRIVATE_KEYS ?? "";
  const result: Record<string, string> = {};
  for (const pair of raw.split(",")) {
    const idx = pair.indexOf(":");
    if (idx === -1) continue;
    const slug = pair.slice(0, idx).trim();
    const key = pair.slice(idx + 1).trim();
    if (slug && key) result[slug] = key;
  }
  return result;
}
