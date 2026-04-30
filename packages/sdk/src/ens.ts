import {
  normalize,
  getEnsText,
  getEnsAddress,
  getEnsResolver,
  type GetEnsTextReturnType,
} from "viem/ens";
import { type PublicClient } from "viem";
import { setRecords } from "@ensdomains/ensjs/wallet";
import { client as defaultClient } from "./config/config";

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

export async function setBiomeRecords(
  name: string,
  root: `0x${string}`,
  version: number,
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
  const hash = await setRecords(wallet, {
    name: normalizedName,
    resolverAddress,
    account: wallet.account,
    texts: [
      { key: "biome.root", value: root },
      { key: "biome.version", value: String(version) },
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

// wallet must be created with addEnsContracts(chain) as its chain
export async function setAgentRecords(
  name: string,
  records: AgentRecords,
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

  const hash = await setRecords(wallet, {
    name: normalizedName,
    resolverAddress,
    account: wallet.account,
    coins: [{ coin: "ETH", value: records.addr }],
    texts: [
      { key: "hermes.pubkey", value: records.pubkey },
      { key: "hermes.inbox", value: records.inbox },
    ],
  });

  // wait for inclusion so subsequent resolveAgent() reads see the new state
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}
