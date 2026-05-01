import {
  normalize,
  getEnsText,
  getEnsAddress,
  getEnsResolver,
  type GetEnsTextReturnType,
} from "viem/ens";
import {
  namehash,
  encodeFunctionData,
  encodePacked,
  type PublicClient,
} from "viem";
import { client as defaultClient } from "./config/config";

// Minimal ENS PublicResolver ABI — only what we need for setting records.
// Bypasses @ensdomains/ensjs/wallet which breaks under viem 2.x peer skew.
const RESOLVER_ABI = [
  {
    type: "function",
    name: "multicall",
    stateMutability: "nonpayable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "setAddr",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "coinType", type: "uint256" },
      { name: "a", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "setText",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
      { name: "value", type: "string" },
    ],
    outputs: [],
  },
] as const;

const COIN_TYPE_ETH = 60n;

export type AgentRecords = {
  addr: `0x${string}`;
  pubkey: string;
  inbox: string;
};

export async function resolveEnsRecord(
  name: string,
  key: string,
): Promise<GetEnsTextReturnType> {
  const normalizedName = normalize(name);
  const value = await getEnsText(defaultClient, { name: normalizedName, key });
  console.log(`ENS record ${key} for ${name}: ${value}`);
  return value;
}

export async function resolveAgent(
  name: string,
  client: PublicClient,
): Promise<AgentRecords> {
  const normalizedName = normalize(name);
  const [addr, pubkey, inbox] = await Promise.all([
    getEnsAddress(client, { name: normalizedName }),
    getEnsText(client, { name: normalizedName, key: "hermes.pubkey" }),
    getEnsText(client, { name: normalizedName, key: "hermes.inbox" }),
  ]);
  if (!addr || !pubkey || !inbox) {
    throw new Error(`Missing ENS records for ${name}`);
  }
  return { addr, pubkey, inbox };
}

export async function resolveBiomeRecords(
  name: string,
  client: PublicClient,
): Promise<{ root: `0x${string}`; version: number }> {
  const normalizedName = normalize(name);
  const [root, version] = await Promise.all([
    getEnsText(client, { name: normalizedName, key: "biome.root" }),
    getEnsText(client, { name: normalizedName, key: "biome.version" }),
  ]);
  if (!root || !version) {
    throw new Error(`Missing biome ENS records for ${name}`);
  }
  return { root: root as `0x${string}`, version: Number(version) };
}

async function multicallResolver(
  name: string,
  texts: Array<{ key: string; value: string }>,
  addr: `0x${string}` | undefined,
  publicClient: PublicClient,
  wallet: any,
): Promise<`0x${string}`> {
  const normalizedName = normalize(name);
  const resolverAddress = await getEnsResolver(publicClient, {
    name: normalizedName,
  });
  if (!resolverAddress) {
    throw new Error(`No resolver found for ENS name ${name}`);
  }

  const node = namehash(normalizedName);
  const calls: `0x${string}`[] = [];
  if (addr) {
    calls.push(
      encodeFunctionData({
        abi: RESOLVER_ABI,
        functionName: "setAddr",
        args: [node, COIN_TYPE_ETH, encodePacked(["address"], [addr])],
      }),
    );
  }
  for (const t of texts) {
    calls.push(
      encodeFunctionData({
        abi: RESOLVER_ABI,
        functionName: "setText",
        args: [node, t.key, t.value],
      }),
    );
  }

  const account = wallet.account ?? wallet.account?.address;
  if (!account) {
    throw new Error("wallet has no account; pass a WalletClient with an account");
  }

  const hash = (await wallet.writeContract({
    address: resolverAddress,
    abi: RESOLVER_ABI,
    functionName: "multicall",
    args: [calls],
    account: wallet.account,
    chain: wallet.chain,
  })) as `0x${string}`;

  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function setBiomeRecords(
  name: string,
  root: `0x${string}`,
  version: number,
  publicClient: PublicClient,
  wallet: any,
): Promise<`0x${string}`> {
  return multicallResolver(
    name,
    [
      { key: "biome.root", value: root },
      { key: "biome.version", value: String(version) },
    ],
    undefined,
    publicClient,
    wallet,
  );
}

// wallet must be created with addEnsContracts(chain) as its chain
export async function setAgentRecords(
  name: string,
  records: AgentRecords,
  publicClient: PublicClient,
  wallet: any,
): Promise<`0x${string}`> {
  return multicallResolver(
    name,
    [
      { key: "hermes.pubkey", value: records.pubkey },
      { key: "hermes.inbox", value: records.inbox },
    ],
    records.addr,
    publicClient,
    wallet,
  );
}
