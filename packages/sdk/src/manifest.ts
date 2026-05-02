import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import type { Account, WalletClient } from "viem";
import {
  decryptMessage,
  encryptMessage,
  signEIP191,
  verifyEIP191,
} from "./crypto.js";
import { canonicalize } from "./envelope.js";

const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = naclUtil;

export const MANIFEST_VERSION = 1 as const;
export const MANIFEST_ENTRY_CAP = 100;

export type ManifestKind = "context" | "history";

export type ManifestEntry = {
  ts: number;
  from: string; // sender ENS
  rootHash: `0x${string}`; // 0G rootHash of the message envelope
  thread?: string;
  /** Plaintext copy of the message body. Optional. When set, lets a
   * future caller walk the chain and reconstruct full transcripts —
   * including bodies the caller could not decrypt off the on-chain
   * envelope (e.g. messages they sent themselves, sealed for someone
   * else's pubkey). Body inherits the manifest's own encryption +
   * signature, so it's never plaintext on the wire. */
  body?: string;
};

export type Manifest = {
  v: 1;
  kind: ManifestKind;
  entries: ManifestEntry[];
  createdBy: string; // ENS of signer
  createdAt: number; // unix seconds
  prev?: `0x${string}`; // only meaningful when kind = "history"
  sig: `0x${string}`;
};

export type UnsignedManifest = Omit<Manifest, "sig">;

export type EncryptedManifestBlob =
  | {
      v: 1;
      alg: "nacl-secretbox";
      nonce: string;
      ciphertext: string;
    }
  | {
      v: 1;
      alg: "nacl-box";
      nonce: string;
      ciphertext: string;
      ephemeralPubKey: string; // sender X25519 pubkey, base64
    };

export type EncryptCtx =
  | { kind: "biome"; K: Uint8Array }
  | {
      kind: "1:1";
      senderPublicKey: string; // base64
      senderSecretKey: string; // base64
      recipientPublicKey: string; // base64
    };

export type DecryptCtx =
  | { kind: "biome"; K: Uint8Array }
  | {
      kind: "1:1";
      recipientSecretKey: string; // base64
      expectedSenderPublicKey?: string; // base64; if set, blob ephemeralPubKey must match
    };

// Minimal storage interface satisfied by ZeroGStorage; lets tests inject a memory-backed mock.
export interface BlobStorage {
  uploadBlob(bytes: Uint8Array): Promise<`0x${string}`>;
  downloadBlob(rootHash: `0x${string}`): Promise<Uint8Array>;
}

export function manifestSigningPayload(m: UnsignedManifest): string {
  return canonicalize(m);
}

async function signManifest(
  unsigned: UnsignedManifest,
  wallet: WalletClient & { account: Account },
): Promise<Manifest> {
  const sig = await signEIP191(wallet, manifestSigningPayload(unsigned));
  return { ...unsigned, sig };
}

function encryptManifest(m: Manifest, ctx: EncryptCtx): EncryptedManifestBlob {
  const json = canonicalize(m);
  if (ctx.kind === "biome") {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ct = nacl.secretbox(decodeUTF8(json), nonce, ctx.K);
    return {
      v: 1,
      alg: "nacl-secretbox",
      nonce: encodeBase64(nonce),
      ciphertext: encodeBase64(ct),
    };
  }
  const enc = encryptMessage(json, ctx.recipientPublicKey, ctx.senderSecretKey);
  return {
    v: 1,
    alg: "nacl-box",
    nonce: enc.nonce,
    ciphertext: enc.ciphertext,
    ephemeralPubKey: ctx.senderPublicKey,
  };
}

function decryptManifest(
  blob: EncryptedManifestBlob,
  ctx: DecryptCtx,
): Manifest {
  let json: string;
  if (blob.alg === "nacl-secretbox") {
    if (ctx.kind !== "biome") {
      throw new Error("biome-encrypted manifest requires biome decryption ctx");
    }
    const pt = nacl.secretbox.open(
      decodeBase64(blob.ciphertext),
      decodeBase64(blob.nonce),
      ctx.K,
    );
    if (!pt) throw new Error("manifest decryption failed");
    json = encodeUTF8(pt);
  } else {
    if (ctx.kind !== "1:1") {
      throw new Error("1:1-encrypted manifest requires 1:1 decryption ctx");
    }
    if (
      ctx.expectedSenderPublicKey !== undefined &&
      ctx.expectedSenderPublicKey !== blob.ephemeralPubKey
    ) {
      throw new Error("manifest sender pubkey mismatch");
    }
    json = decryptMessage(
      blob.ciphertext,
      blob.nonce,
      blob.ephemeralPubKey,
      ctx.recipientSecretKey,
    );
  }
  return JSON.parse(json) as Manifest;
}

async function uploadManifest(
  manifest: Manifest,
  encrypt: EncryptCtx,
  storage: BlobStorage,
): Promise<`0x${string}`> {
  const blob = encryptManifest(manifest, encrypt);
  const bytes = new TextEncoder().encode(canonicalize(blob));
  return storage.uploadBlob(bytes);
}

export type BuildContextManifestArgs = {
  entries: ManifestEntry[];
  createdBy: string;
  wallet: WalletClient & { account: Account };
  encrypt: EncryptCtx;
  storage: BlobStorage;
  createdAt?: number;
};

export async function buildContextManifest(
  args: BuildContextManifestArgs,
): Promise<{ root: `0x${string}`; manifest: Manifest }> {
  if (args.entries.length > MANIFEST_ENTRY_CAP) {
    throw new Error(
      `context manifest has ${args.entries.length} entries; cap is ${MANIFEST_ENTRY_CAP}`,
    );
  }
  const unsigned: UnsignedManifest = {
    v: MANIFEST_VERSION,
    kind: "context",
    entries: args.entries,
    createdBy: args.createdBy,
    createdAt: args.createdAt ?? Math.floor(Date.now() / 1000),
  };
  const manifest = await signManifest(unsigned, args.wallet);
  const root = await uploadManifest(manifest, args.encrypt, args.storage);
  return { root, manifest };
}

export type BuildHistoryManifestArgs = {
  entries: ManifestEntry[];
  prev?: `0x${string}`;
  createdBy: string;
  wallet: WalletClient & { account: Account };
  encrypt: EncryptCtx;
  storage: BlobStorage;
  createdAt?: number;
};

export async function buildHistoryManifest(
  args: BuildHistoryManifestArgs,
): Promise<{ root: `0x${string}`; manifest: Manifest }> {
  if (args.entries.length > MANIFEST_ENTRY_CAP) {
    throw new Error(
      `history manifest has ${args.entries.length} entries; cap is ${MANIFEST_ENTRY_CAP}`,
    );
  }
  const unsigned: UnsignedManifest = {
    v: MANIFEST_VERSION,
    kind: "history",
    entries: args.entries,
    createdBy: args.createdBy,
    createdAt: args.createdAt ?? Math.floor(Date.now() / 1000),
    prev: args.prev,
  };
  const manifest = await signManifest(unsigned, args.wallet);
  const root = await uploadManifest(manifest, args.encrypt, args.storage);
  return { root, manifest };
}

async function verifyManifestSig(
  manifest: Manifest,
  creatorAddress: `0x${string}`,
): Promise<boolean> {
  const { sig, ...unsigned } = manifest;
  return verifyEIP191(creatorAddress, manifestSigningPayload(unsigned), sig);
}

export type LoadManifestArgs = {
  root: `0x${string}`;
  decrypt: DecryptCtx;
  storage: BlobStorage;
  expectedCreatorAddress?: `0x${string}`;
};

export async function loadManifest(args: LoadManifestArgs): Promise<Manifest> {
  const bytes = await args.storage.downloadBlob(args.root);
  const blob = JSON.parse(
    new TextDecoder().decode(bytes),
  ) as EncryptedManifestBlob;
  const manifest = decryptManifest(blob, args.decrypt);

  if (args.expectedCreatorAddress) {
    const ok = await verifyManifestSig(manifest, args.expectedCreatorAddress);
    if (!ok) throw new Error("manifest signature invalid");
  }
  return manifest;
}

export type WalkHistoryOpts = {
  /** Stop after yielding this many entries. */
  maxEntries?: number;
  /** Stop after following this many `prev` links. Default 1024 (cycle/runaway guard). */
  maxDepth?: number;
  /** If provided, every manifest's signature is verified against `resolveCreator(manifest.createdBy)`. */
  resolveCreator?: (createdBy: string) => Promise<`0x${string}`>;
};

/**
 * Walks a history chain newest → oldest. Within a single manifest, entries
 * are yielded in their stored order. Cycle detection is mandatory.
 */
export async function* walkHistory(
  startRoot: `0x${string}`,
  decrypt: DecryptCtx,
  storage: BlobStorage,
  opts: WalkHistoryOpts = {},
): AsyncIterableIterator<ManifestEntry> {
  const maxEntries = opts.maxEntries ?? Number.POSITIVE_INFINITY;
  const maxDepth = opts.maxDepth ?? 1024;
  const seen = new Set<string>();
  let root: `0x${string}` | undefined = startRoot;
  let yielded = 0;
  let depth = 0;

  while (root && depth < maxDepth) {
    if (seen.has(root)) throw new Error(`history cycle at ${root}`);
    seen.add(root);

    const manifest = await loadManifest({ root, decrypt, storage });
    if (manifest.kind !== "history") {
      throw new Error(
        `expected history manifest at ${root}, got ${manifest.kind}`,
      );
    }
    if (opts.resolveCreator) {
      const addr = await opts.resolveCreator(manifest.createdBy);
      const ok = await verifyManifestSig(manifest, addr);
      if (!ok) throw new Error(`history manifest signature invalid at ${root}`);
    }

    for (const entry of manifest.entries) {
      yield entry;
      yielded++;
      if (yielded >= maxEntries) return;
    }
    root = manifest.prev;
    depth++;
  }
}

/**
 * Merge multiple linear histories (e.g. two senders forking from the same `prev`)
 * into a single deterministic ordering by (ts, from, rootHash).
 */
export function mergeForkedHistories(
  branches: ManifestEntry[][],
): ManifestEntry[] {
  const all = branches.flat();
  return all.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    if (a.from !== b.from) return a.from < b.from ? -1 : 1;
    return a.rootHash < b.rootHash ? -1 : 1;
  });
}
