// Anima — the soul of an agent. A signed, public, mostly-static JSON blob
// pinned by 0G rootHash and advertised on the agent's ENS subname via
// `text("hermes.anima")`. Owner-only mutable (the ENS name owner controls
// the text record). Optional: agents that don't have an Anima published
// just don't have one — `resolveAnima` returns null cleanly.
//
// Counterpart to Animus (the soul of a biome) in `animus.ts`. Anima is
// public (signed plaintext); Animus is private (signed ciphertext, sealed
// with the biome key K).

import { type PublicClient, type WalletClient, type Account } from "viem";
import { getEnsText, normalize } from "viem/ens";
import { canonicalize } from "./envelope";
import { signEIP191, verifyEIP191 } from "./crypto";
import { resolveAgent } from "./ens";
import { ZeroGStorage } from "./storage";

export const ANIMA_TEXT_KEY = "hermes.anima";
export const ANIMA_VERSION = 1 as const;

export type AnimaDoc = {
  v: 1;
  ens: string; // canonical ENS name this anima belongs to
  ownerAddr: `0x${string}`; // ENS owner / signer at publish time
  content: string; // freeform text/markdown the owner wants in scope
  createdAt: number; // unix seconds
  sig: `0x${string}`; // EIP-191 over canonicalize(doc minus sig)
};

export type UnsignedAnimaDoc = Omit<AnimaDoc, "sig">;

export function animaSigningPayload(doc: UnsignedAnimaDoc): string {
  return canonicalize(doc);
}

/** Build, sign, and upload a fresh AnimaDoc. Caller writes the rootHash to
 * ENS (`hermes.anima`) separately via `setAnimaRecord`. */
export async function buildAnima(
  args: {
    ens: string;
    content: string;
    storage: ZeroGStorage;
  },
  wallet: WalletClient & { account: Account },
): Promise<{ doc: AnimaDoc; root: `0x${string}` }> {
  const unsigned: UnsignedAnimaDoc = {
    v: 1,
    ens: args.ens,
    ownerAddr: wallet.account.address,
    content: args.content,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const sig = await signEIP191(wallet, animaSigningPayload(unsigned));
  const doc: AnimaDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(doc));
  const root = await args.storage.uploadBlob(blob);
  return { doc, root };
}

export async function verifyAnima(
  doc: AnimaDoc,
  signerAddr: `0x${string}`,
): Promise<boolean> {
  const { sig, ...unsigned } = doc;
  return verifyEIP191(signerAddr, animaSigningPayload(unsigned), sig);
}

/** Read the agent's `hermes.anima` ENS text record, fetch + verify the doc.
 * Returns null if the record isn't set, so callers can opt-in safely. */
export async function resolveAnima(
  ens: string,
  publicClient: PublicClient,
  storage: ZeroGStorage,
): Promise<{ doc: AnimaDoc; root: `0x${string}` } | null> {
  const root = (await getEnsText(publicClient, {
    name: normalize(ens),
    key: ANIMA_TEXT_KEY,
  })) as `0x${string}` | null;
  if (!root) return null;

  const bytes = await storage.downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as AnimaDoc;

  // Verify against the agent's ENS-resolved address.
  const agent = await resolveAgent(ens, publicClient);
  const ok = await verifyAnima(doc, agent.addr);
  if (!ok) {
    throw new Error(`anima signature invalid for ${ens}`);
  }
  return { doc, root };
}
