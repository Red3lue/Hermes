import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { type PublicClient, type WalletClient, type Account } from "viem";
import { getEnsAddress } from "viem/ens";
import { normalize } from "viem/ens";
import {
  encryptMessage,
  decryptMessage,
  signEIP191,
  verifyEIP191,
  type KeyPair,
} from "./crypto";
import {
  canonicalize,
  envelopeSigningPayload,
  type Envelope,
  type UnsignedEnvelope,
} from "./envelope";
import { resolveAgent, resolveBiomeRecords, setBiomeRecords } from "./ens";
import { ZeroGStorage } from "./storage";

const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = naclUtil;

export type BiomeMember = {
  ens: string;
  pubkey: string; // X25519 base64
};

export type BiomeWrap = {
  ciphertext: string; // base64
  nonce: string; // base64
};

export type BiomeDoc = {
  v: 1;
  name: string; // canonical biome ENS name e.g. research.biomes.parent.eth
  goal: string;
  rules: Record<string, unknown>;
  members: BiomeMember[];
  wraps: Record<string, BiomeWrap>; // keyed by member ens
  ownerEns: string;
  ownerPubkey: string; // X25519 base64; embedded so readers don't need a 2nd ENS lookup
  version: number;
  createdAt: number; // unix seconds
  sig: `0x${string}`; // EIP-191 over canonicalize(doc minus sig)
};

export type UnsignedBiomeDoc = Omit<BiomeDoc, "sig">;

export type BiomeContext = {
  publicClient: PublicClient;
  wallet: WalletClient & { account: Account };
  storage: ZeroGStorage;
  myEns: string;
  myKeys: KeyPair;
};

export function biomeSigningPayload(doc: UnsignedBiomeDoc): string {
  return canonicalize(doc);
}

export function wrapKey(
  K: Uint8Array,
  recipientPubKeyB64: string,
  ownerSecretKeyB64: string,
): BiomeWrap {
  return encryptMessage(encodeBase64(K), recipientPubKeyB64, ownerSecretKeyB64);
}

export function unwrapKey(
  wrap: BiomeWrap,
  ownerPubKeyB64: string,
  myPrivKeyB64: string,
): Uint8Array {
  const KBase64 = decryptMessage(
    wrap.ciphertext,
    wrap.nonce,
    ownerPubKeyB64,
    myPrivKeyB64,
  );
  return decodeBase64(KBase64);
}

export function buildUnsignedBiomeDoc(args: {
  name: string;
  goal: string;
  rules?: Record<string, unknown>;
  members: BiomeMember[];
  ownerEns: string;
  ownerPubkey: string;
  ownerSecretKey: string;
  version: number;
  K: Uint8Array;
  createdAt?: number;
}): UnsignedBiomeDoc {
  const wraps: Record<string, BiomeWrap> = {};
  for (const m of args.members) {
    wraps[m.ens] = wrapKey(args.K, m.pubkey, args.ownerSecretKey);
  }
  return {
    v: 1,
    name: args.name,
    goal: args.goal,
    rules: args.rules ?? {},
    members: args.members,
    wraps,
    ownerEns: args.ownerEns,
    ownerPubkey: args.ownerPubkey,
    version: args.version,
    createdAt: args.createdAt ?? Math.floor(Date.now() / 1000),
  };
}

export async function verifyBiomeDoc(
  doc: BiomeDoc,
  ownerAddress: `0x${string}`,
): Promise<boolean> {
  const { sig, ...unsigned } = doc;
  return verifyEIP191(ownerAddress, biomeSigningPayload(unsigned), sig);
}

// network operations

export type CreateBiomeArgs = {
  name: string;
  goal: string;
  members: BiomeMember[]; // owner is expected to be included
  rules?: Record<string, unknown>;
};

export type CreateBiomeResult = {
  root: `0x${string}`;
  version: number;
  K: Uint8Array;
  doc: BiomeDoc;
};

export async function createBiome(
  ctx: BiomeContext,
  args: CreateBiomeArgs,
): Promise<CreateBiomeResult> {
  if (!args.members.some((m) => m.ens === ctx.myEns)) {
    throw new Error("owner must be listed as a member");
  }
  const K = nacl.randomBytes(32);
  const unsigned = buildUnsignedBiomeDoc({
    name: args.name,
    goal: args.goal,
    rules: args.rules,
    members: args.members,
    ownerEns: ctx.myEns,
    ownerPubkey: ctx.myKeys.publicKey,
    ownerSecretKey: ctx.myKeys.secretKey,
    version: 1,
    K,
  });
  const sig = await signEIP191(ctx.wallet, biomeSigningPayload(unsigned));
  const doc: BiomeDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(doc));
  const root = await ctx.storage.uploadBlob(blob);
  await setBiomeRecords(args.name, root, 1, ctx.publicClient, ctx.wallet);
  return { root, version: 1, K, doc };
}

export type JoinBiomeResult = {
  K: Uint8Array;
  doc: BiomeDoc;
  version: number;
  root: `0x${string}`;
};

export async function joinBiome(
  ctx: BiomeContext,
  biomeName: string,
): Promise<JoinBiomeResult> {
  const { root, version } = await resolveBiomeRecords(
    biomeName,
    ctx.publicClient,
  );
  const bytes = await ctx.storage.downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(bytes)) as BiomeDoc;

  const ownerAddr = await getEnsAddress(ctx.publicClient, {
    name: normalize(doc.ownerEns),
  });
  if (!ownerAddr) throw new Error(`cannot resolve owner ${doc.ownerEns}`);
  const sigOk = await verifyBiomeDoc(doc, ownerAddr);
  if (!sigOk) throw new Error(`biome doc signature invalid for ${biomeName}`);

  const wrap = doc.wraps[ctx.myEns];
  if (!wrap) {
    throw new Error(`no wrap for ${ctx.myEns} in ${biomeName} — not a member`);
  }
  const K = unwrapKey(wrap, doc.ownerPubkey, ctx.myKeys.secretKey);
  return { K, doc, version, root };
}

export async function addMember(
  ctx: BiomeContext,
  biomeName: string,
  newMember: BiomeMember,
): Promise<{ root: `0x${string}`; version: number; doc: BiomeDoc }> {
  const { K, doc } = await joinBiome(ctx, biomeName);
  if (doc.ownerEns !== ctx.myEns) {
    throw new Error(`only owner ${doc.ownerEns} can add members`);
  }
  if (doc.wraps[newMember.ens]) {
    throw new Error(`${newMember.ens} is already a member`);
  }
  const wraps = {
    ...doc.wraps,
    [newMember.ens]: wrapKey(K, newMember.pubkey, ctx.myKeys.secretKey),
  };
  const unsigned: UnsignedBiomeDoc = {
    v: 1,
    name: doc.name,
    goal: doc.goal,
    rules: doc.rules,
    members: [...doc.members, newMember],
    wraps,
    ownerEns: doc.ownerEns,
    ownerPubkey: doc.ownerPubkey,
    version: doc.version + 1,
    createdAt: Math.floor(Date.now() / 1000),
  };
  const sig = await signEIP191(ctx.wallet, biomeSigningPayload(unsigned));
  const newDoc: BiomeDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(newDoc));
  const root = await ctx.storage.uploadBlob(blob);
  await setBiomeRecords(
    biomeName,
    root,
    newDoc.version,
    ctx.publicClient,
    ctx.wallet,
  );
  return { root, version: newDoc.version, doc: newDoc };
}

export async function removeMember(
  ctx: BiomeContext,
  biomeName: string,
  memberEns: string,
): Promise<{
  root: `0x${string}`;
  version: number;
  K: Uint8Array;
  doc: BiomeDoc;
}> {
  const { doc } = await joinBiome(ctx, biomeName);
  if (doc.ownerEns !== ctx.myEns) {
    throw new Error(`only owner can remove members`);
  }
  if (memberEns === ctx.myEns)
    throw new Error(`owner cannot remove themselves`);
  if (!doc.wraps[memberEns]) throw new Error(`${memberEns} is not a member`);

  const Knew = nacl.randomBytes(32);
  const survivors = doc.members.filter((m) => m.ens !== memberEns);
  const unsigned = buildUnsignedBiomeDoc({
    name: doc.name,
    goal: doc.goal,
    rules: doc.rules,
    members: survivors,
    ownerEns: doc.ownerEns,
    ownerPubkey: doc.ownerPubkey,
    ownerSecretKey: ctx.myKeys.secretKey,
    version: doc.version + 1,
    K: Knew,
  });
  const sig = await signEIP191(ctx.wallet, biomeSigningPayload(unsigned));
  const newDoc: BiomeDoc = { ...unsigned, sig };
  const blob = new TextEncoder().encode(canonicalize(newDoc));
  const root = await ctx.storage.uploadBlob(blob);
  await setBiomeRecords(
    biomeName,
    root,
    newDoc.version,
    ctx.publicClient,
    ctx.wallet,
  );
  return { root, version: newDoc.version, K: Knew, doc: newDoc };
}

// --- biome message helpers (envelope v2) ----------------------------------

export function encryptBiomePayload(
  payload: string,
  K: Uint8Array,
): { ciphertext: string; nonce: string } {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ct = nacl.secretbox(decodeUTF8(payload), nonce, K);
  return { ciphertext: encodeBase64(ct), nonce: encodeBase64(nonce) };
}

export function decryptBiomePayload(
  ciphertext: string,
  nonce: string,
  K: Uint8Array,
): string {
  const pt = nacl.secretbox.open(
    decodeBase64(ciphertext),
    decodeBase64(nonce),
    K,
  );
  if (!pt) throw new Error("biome decryption failed");
  return encodeUTF8(pt);
}

export type BuildBiomeEnvelopeArgs = {
  fromEns: string;
  biomeName: string;
  biomeVersion: number;
  biomeRoot: `0x${string}`;
  payload: string;
  K: Uint8Array;
  thread?: string;
  context?: `0x${string}`;
  history?: `0x${string}`;
};

export async function buildBiomeEnvelope(
  args: BuildBiomeEnvelopeArgs,
  wallet: WalletClient & { account: Account },
): Promise<Envelope> {
  const { ciphertext, nonce } = encryptBiomePayload(args.payload, args.K);
  const unsigned: UnsignedEnvelope = {
    v: 2,
    from: args.fromEns,
    to: args.biomeName,
    ts: Math.floor(Date.now() / 1000),
    nonce,
    ciphertext,
    biome: {
      name: args.biomeName,
      version: args.biomeVersion,
      root: args.biomeRoot,
    },
    thread: args.thread,
    context: args.context,
    history: args.history,
  };
  const sig = await signEIP191(wallet, envelopeSigningPayload(unsigned));
  return { ...unsigned, sig };
}

export type DecryptedBiomeEnvelope = {
  text: string;
  envelope: Envelope;
};

export async function decryptBiomeEnvelope(
  env: Envelope,
  K: Uint8Array,
  doc: BiomeDoc,
  publicClient: PublicClient,
): Promise<DecryptedBiomeEnvelope> {
  if (!env.biome) throw new Error("envelope is not biome-scoped");
  if (env.biome.name !== doc.name) {
    throw new Error(
      `envelope biome ${env.biome.name} does not match cached ${doc.name}`,
    );
  }
  const member = doc.members.find((m) => m.ens === env.from);
  if (!member) throw new Error(`sender ${env.from} is not a member of ${doc.name}`);

  const sender = await resolveAgent(env.from, publicClient);
  const { sig, ...unsigned } = env;
  const sigOk = await verifyEIP191(
    sender.addr,
    envelopeSigningPayload(unsigned),
    sig,
  );
  if (!sigOk) throw new Error("bad signature");

  const text = decryptBiomePayload(env.ciphertext, env.nonce, K);
  return { text, envelope: env };
}
