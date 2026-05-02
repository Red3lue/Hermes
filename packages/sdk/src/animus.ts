// Animus — the soul of a biome. A signed, encrypted JSON blob pinned by
// 0G rootHash and advertised on the biome's ENS subname via
// `text("biome.animus")`. The blob is encrypted with the biome key K
// (secretbox), so only members can read it. The signature is over the
// CIPHERTEXT (hackathon-grade pragmatic choice — anyone with access to the
// 0G blob can verify owner provenance without first needing K).
//
// Owner-only mutable: only the biome owner can re-publish (they sign;
// non-owner sigs are rejected). Updating means: build a new doc, sign,
// upload, replace the ENS text record with the new rootHash. Old versions
// remain on 0G but no longer authoritative.

import { type PublicClient, type WalletClient, type Account } from "viem";
import { getEnsText, normalize } from "viem/ens";
import { canonicalize } from "./envelope";
import { signEIP191, verifyEIP191 } from "./crypto";
import { encryptBiomePayload, decryptBiomePayload } from "./biome";
import { ZeroGStorage } from "./storage";

export const ANIMUS_TEXT_KEY = "biome.animus";
export const ANIMUS_VERSION = 1 as const;

/** On-disk shape of an Animus blob. The plaintext content is sealed with
 * the biome's symmetric key K (secretbox); `sig` is over the canonical
 * ciphertext doc. */
export type AnimusDoc = {
  v: 1;
  biomeName: string;
  ownerAddr: `0x${string}`;
  ownerEns: string;
  ciphertext: string; // base64 secretbox(content, K)
  nonce: string; // base64 secretbox nonce
  createdAt: number;
  sig: `0x${string}`; // EIP-191 over canonicalize(doc minus sig)
};

export type UnsignedAnimusDoc = Omit<AnimusDoc, "sig">;

export function animusSigningPayload(doc: UnsignedAnimusDoc): string {
  return canonicalize(doc);
}

/** Build, encrypt, sign, and upload a fresh AnimusDoc. Caller writes the
 * rootHash to ENS (`biome.animus`) separately via `setAnimusRecord`. */
export async function buildAnimus(
  args: {
    biomeName: string;
    ownerEns: string;
    content: string;
    K: Uint8Array;
    storage: ZeroGStorage;
  },
  wallet: WalletClient & { account: Account },
): Promise<{ doc: AnimusDoc; root: `0x${string}` }> {
  const { ciphertext, nonce } = encryptBiomePayload(args.content, args.K);
  const unsigned: UnsignedAnimusDoc = {
    v: 1,
    biomeName: args.biomeName,
    ownerAddr: wallet.account.address,
    ownerEns: args.ownerEns,
    ciphertext,
    nonce,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const sig = await signEIP191(wallet, animusSigningPayload(unsigned));
  const doc: AnimusDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(doc));
  const root = await args.storage.uploadBlob(blob);
  return { doc, root };
}

export async function verifyAnimus(
  doc: AnimusDoc,
  ownerAddr: `0x${string}`,
): Promise<boolean> {
  const { sig, ...unsigned } = doc;
  return verifyEIP191(ownerAddr, animusSigningPayload(unsigned), sig);
}

/** Read the biome's `biome.animus` ENS text record, fetch the blob,
 * verify the owner sig, and decrypt with K. Returns null if the record
 * isn't set. */
export async function resolveAnimus(
  biomeName: string,
  K: Uint8Array,
  publicClient: PublicClient,
  storage: ZeroGStorage,
): Promise<{ doc: AnimusDoc; content: string; root: `0x${string}` } | null> {
  const root = (await getEnsText(publicClient, {
    name: normalize(biomeName),
    key: ANIMUS_TEXT_KEY,
  })) as `0x${string}` | null;
  if (!root) return null;

  const bytes = await storage.downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as AnimusDoc;

  const sigOk = await verifyAnimus(doc, doc.ownerAddr);
  if (!sigOk) {
    throw new Error(`animus signature invalid for ${biomeName}`);
  }
  const content = decryptBiomePayload(doc.ciphertext, doc.nonce, K);
  return { doc, content, root };
}
