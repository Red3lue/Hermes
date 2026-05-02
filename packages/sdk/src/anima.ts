// Anima — the soul of an agent. A signed, ENCRYPTED JSON blob pinned by
// 0G rootHash and advertised on the agent's ENS subname via
// `text("hermes.anima")`. Owner-only mutable.
//
// Encryption: nacl.box (X25519 + XSalsa20-Poly1305) with the agent's own
// keypair as both sender and recipient — same scheme used for 1:1
// messages. Only a holder of the agent's secret key (the owner who can
// re-derive from their wallet, OR the runtime which loaded the keystore)
// can decrypt.
//
// Signature: EIP-191 over the canonicalized ciphertext doc — matches the
// Animus pattern. Anyone can verify provenance against the owner's
// address without holding the secret key.

import { type PublicClient, type WalletClient, type Account } from "viem";
import { getEnsText, normalize } from "viem/ens";
import { canonicalize } from "./envelope.js";
import {
  signEIP191,
  verifyEIP191,
  encryptMessage,
  decryptMessage,
} from "./crypto.js";
import { resolveAgent } from "./ens.js";
import { ZeroGStorage } from "./storage.js";

export const ANIMA_TEXT_KEY = "hermes.anima";
export const ANIMA_VERSION = 1 as const;

export type AnimaDoc = {
  v: 1;
  ens: string;
  ownerAddr: `0x${string}`;
  ownerPubkey: string; // X25519 base64; encryption recipient identity
  ciphertext: string; // base64 nacl.box(content)
  nonce: string; // base64 nacl.box nonce
  createdAt: number;
  sig: `0x${string}`; // EIP-191 over canonicalize(doc minus sig)
};

export type UnsignedAnimaDoc = Omit<AnimaDoc, "sig">;

export function animaSigningPayload(doc: UnsignedAnimaDoc): string {
  return canonicalize(doc);
}

/** Build, encrypt, sign, and upload a fresh AnimaDoc.
 *
 * `ownerPubkey` and `ownerSecretKey` are the agent's own X25519 keypair
 * (deterministically derived from the owner's wallet sig). Encryption is
 * a self-box: sender = recipient = agent owner, so only a holder of the
 * matching secret key can decrypt. */
export async function buildAnima(
  args: {
    ens: string;
    content: string;
    ownerPubkey: string;
    ownerSecretKey: string;
    storage: ZeroGStorage;
  },
  wallet: WalletClient & { account: Account },
): Promise<{ doc: AnimaDoc; root: `0x${string}` }> {
  const { ciphertext, nonce } = encryptMessage(
    args.content,
    args.ownerPubkey,
    args.ownerSecretKey,
  );
  const unsigned: UnsignedAnimaDoc = {
    v: 1,
    ens: args.ens,
    ownerAddr: wallet.account.address,
    ownerPubkey: args.ownerPubkey,
    ciphertext,
    nonce,
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

/** Decrypt an AnimaDoc with the agent's secret key. */
export function decryptAnima(doc: AnimaDoc, ownerSecretKey: string): string {
  return decryptMessage(
    doc.ciphertext,
    doc.nonce,
    doc.ownerPubkey,
    ownerSecretKey,
  );
}

/** Read the agent's `hermes.anima` ENS text record, fetch + verify the
 * doc. Does NOT decrypt — call `decryptAnima` separately if you hold the
 * secret. Returns null if the record isn't set. */
export async function peekAnima(
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

  const agent = await resolveAgent(ens, publicClient);
  const ok = await verifyAnima(doc, agent.addr);
  if (!ok) {
    throw new Error(`anima signature invalid for ${ens}`);
  }
  return { doc, root };
}

/** Read, verify, and decrypt the agent's Anima in one call. Caller must
 * hold the agent's X25519 secret key. */
export async function resolveAnima(
  ens: string,
  ownerSecretKey: string,
  publicClient: PublicClient,
  storage: ZeroGStorage,
): Promise<{ doc: AnimaDoc; content: string; root: `0x${string}` } | null> {
  const r = await peekAnima(ens, publicClient, storage);
  if (!r) return null;
  const content = decryptAnima(r.doc, ownerSecretKey);
  return { doc: r.doc, content, root: r.root };
}
