import type { WalletClient } from "viem";
import {
  signEIP191,
  animaSigningPayload,
  animusSigningPayload,
  setAnimaRecord,
  setAnimusRecord,
  encryptBiomePayload,
  type AnimaDoc,
  type AnimusDoc,
  type UnsignedAnimaDoc,
  type UnsignedAnimusDoc,
} from "@hermes/sdk";
import { publicClient } from "./chainConfig";

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

// Mirrors `canonicalize` from the SDK envelope module — sorted keys, no
// whitespace, drop undefined. Kept inline so we don't pull the whole
// module into the FE bundle path.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

async function uploadViaProxy(bytes: Uint8Array): Promise<`0x${string}`> {
  const r = await fetch(`${BASE}/blob`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as BodyInit,
  });
  if (!r.ok) throw new Error(`proxy upload → ${r.status}`);
  const j = (await r.json()) as { rootHash: `0x${string}` };
  return j.rootHash;
}

/** Publish a new Anima for an agent the user owns. Two on-chain signatures:
 * one EIP-191 over the doc, one ENS multicall to setText. */
export async function publishAnima(args: {
  ens: string;
  ownerAddr: `0x${string}`;
  content: string;
  walletClient: WalletClient;
}): Promise<{ root: `0x${string}`; tx: `0x${string}` }> {
  const unsigned: UnsignedAnimaDoc = {
    v: 1,
    ens: args.ens,
    ownerAddr: args.ownerAddr,
    content: args.content,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const sig = await signEIP191(
    args.walletClient as never,
    animaSigningPayload(unsigned),
  );
  const doc: AnimaDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(doc));
  const root = await uploadViaProxy(blob);
  const tx = await setAnimaRecord(
    args.ens,
    root,
    publicClient,
    args.walletClient as never,
  );
  return { root, tx };
}

/** Publish a new Animus for a biome the user owns. Encrypts with K, signs
 * the ciphertext doc, uploads, sets the ENS text record. */
export async function publishAnimus(args: {
  biomeName: string;
  ownerEns: string;
  ownerAddr: `0x${string}`;
  content: string;
  K: Uint8Array;
  walletClient: WalletClient;
}): Promise<{ root: `0x${string}`; tx: `0x${string}` }> {
  const { ciphertext, nonce } = encryptBiomePayload(args.content, args.K);
  const unsigned: UnsignedAnimusDoc = {
    v: 1,
    biomeName: args.biomeName,
    ownerAddr: args.ownerAddr,
    ownerEns: args.ownerEns,
    ciphertext,
    nonce,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const sig = await signEIP191(
    args.walletClient as never,
    animusSigningPayload(unsigned),
  );
  const doc: AnimusDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(doc));
  const root = await uploadViaProxy(blob);
  const tx = await setAnimusRecord(
    args.biomeName,
    root,
    publicClient,
    args.walletClient as never,
  );
  return { root, tx };
}
