import { normalize, getEnsText, GetEnsTextReturnType } from "viem/ens";
import { client } from "./config/config";
import { PublicClient, WalletClient } from "viem";

export async function resolveEnsRecord(
  name: string,
  key: string,
): Promise<GetEnsTextReturnType> {
  const normalizedName = normalize(name);
  const publicKey = await getEnsText(client, {
    name: normalizedName,
    key: key,
  });
  console.log(`Public key for ${name}: ${publicKey}`);
  return publicKey;
}

export type AgentRecords = {
  addr: `0x${string}`;
  pubkey: string;
  inbox: string;
};

function isHexAddress(value: string): value is `0x${string}` {
  return /^0x[a-fA-F0-9]+$/.test(value);
}

export async function resolveAgent(
  name: string,
  client: PublicClient,
): Promise<AgentRecords> {
  const normalizedName = normalize(name);
  const [addr, pubkey, inbox] = await Promise.all([
    getEnsText(client, { name: normalizedName, key: "addr" }),
    getEnsText(client, { name: normalizedName, key: "hermes.pubkey" }),
    getEnsText(client, { name: normalizedName, key: "hermes.inbox" }),
  ]);
  if (!addr || !pubkey || !inbox) {
    throw new Error(`Missing ENS records for ${name}`);
  }
  if (!isHexAddress(addr)) {
    throw new Error(`Invalid ENS addr record for ${name}`);
  }
  return { addr, pubkey, inbox };
}

export async function setAgentRecords(
  name: string,
  records: AgentRecords,
  wallet: WalletClient,
): Promise<void> {}
