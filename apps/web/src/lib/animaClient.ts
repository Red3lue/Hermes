import type { WalletClient } from "viem";
import { getEnsText, normalize } from "viem/ens";
import {
  signEIP191,
  animaSigningPayload,
  animusSigningPayload,
  setAnimaRecord,
  setAnimusRecord,
  encryptBiomePayload,
  decryptBiomePayload,
  verifyAnima,
  verifyAnimus,
  resolveAgent,
  ANIMA_TEXT_KEY,
  ANIMUS_TEXT_KEY,
  type AnimaDoc,
  type AnimusDoc,
  type UnsignedAnimaDoc,
  type UnsignedAnimusDoc,
} from "@hermes/sdk";
import { publicClient } from "./chainConfig";
import { downloadBlob } from "./browserStorage";

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

/** FE-side resolver for an agent's Anima. Reads ENS, fetches blob via the
 * 0G download path, verifies the signature against the ENS-resolved owner
 * address. Returns null if no record set. */
export async function resolveAnimaFE(ens: string): Promise<{
  doc: AnimaDoc;
  root: `0x${string}`;
} | null> {
  const root = (await getEnsText(publicClient, {
    name: normalize(ens),
    key: ANIMA_TEXT_KEY,
  })) as `0x${string}` | null;
  if (!root) return null;

  const bytes = await downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as AnimaDoc;
  const agent = await resolveAgent(ens, publicClient);
  const ok = await verifyAnima(doc, agent.addr);
  if (!ok) throw new Error(`anima signature invalid for ${ens}`);
  return { doc, root };
}

/** FE-side resolver for a biome's Animus. Reads ENS, fetches blob,
 * verifies sig, decrypts with K. K must be unwrapped on the caller side
 * (member's private key + biome doc wrap). */
export async function resolveAnimusFE(
  biomeName: string,
  K: Uint8Array,
): Promise<{
  doc: AnimusDoc;
  content: string;
  root: `0x${string}`;
} | null> {
  const root = (await getEnsText(publicClient, {
    name: normalize(biomeName),
    key: ANIMUS_TEXT_KEY,
  })) as `0x${string}` | null;
  if (!root) return null;

  const bytes = await downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as AnimusDoc;
  const sigOk = await verifyAnimus(doc, doc.ownerAddr);
  if (!sigOk) throw new Error(`animus signature invalid for ${biomeName}`);
  const content = decryptBiomePayload(doc.ciphertext, doc.nonce, K);
  return { doc, content, root };
}

/** FE-side: read just the Animus rootHash and metadata without decrypting.
 * Useful for the "encrypted, click decrypt" affordance. */
export async function peekAnimusFE(biomeName: string): Promise<{
  doc: AnimusDoc;
  root: `0x${string}`;
} | null> {
  const root = (await getEnsText(publicClient, {
    name: normalize(biomeName),
    key: ANIMUS_TEXT_KEY,
  })) as `0x${string}` | null;
  if (!root) return null;
  const bytes = await downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as AnimusDoc;
  const sigOk = await verifyAnimus(doc, doc.ownerAddr);
  if (!sigOk) throw new Error(`animus signature invalid for ${biomeName}`);
  return { doc, root };
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
