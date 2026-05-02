import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";

import {
  generateKeyPair,
  signEIP191,
  verifyEIP191,
  buildUnsignedBiomeDoc,
  biomeSigningPayload,
  unwrapKey,
  // wrapKey is used implicitly via buildUnsignedBiomeDoc
  serializeEnvelope,
  parseEnvelope,
  envelopeSigningPayload,
  buildHistoryManifest,
  walkHistory,
  type BiomeDoc,
  type BlobStorage,
} from "../../packages/sdk/src";
import {
  buildBiomeEnvelope,
  decryptBiomePayload,
} from "../../packages/sdk/src/biome";

class MemoryStorage implements BlobStorage {
  private blobs = new Map<string, Uint8Array>();

  async uploadBlob(bytes: Uint8Array): Promise<`0x${string}`> {
    const hash = nacl.hash(bytes);
    const root = ("0x" + Buffer.from(hash.slice(0, 32)).toString("hex")) as `0x${string}`;
    this.blobs.set(root, bytes);
    return root;
  }

  async downloadBlob(root: `0x${string}`): Promise<Uint8Array> {
    const b = this.blobs.get(root);
    if (!b) throw new Error(`not found: ${root}`);
    return b;
  }
}

function makeWallet(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return {
    account,
    signMessage: ({ message }: { message: string }) => account.signMessage({ message }),
  } as any;
}

function eqBytes(a: Uint8Array, b: Uint8Array) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function short(hex: string, n = 10): string {
  if (hex.length <= 2 * n + 2) return hex;
  return `${hex.slice(0, n + 2)}…${hex.slice(-n)}`;
}

function step(label: string) {
  console.log(`\n[step] ${label}`);
  console.log("-".repeat(72));
}

function ok(msg: string) {
  console.log(`  [OK]   ${msg}`);
}

function info(msg: string) {
  console.log(`  [info] ${msg}`);
}

export async function runMockDemo(): Promise<void> {
  const ALICE_PK = "0x59c6995e998f97a5a0044976f7d5f74895f4e4f5fbc26f4f2f8a4e4c9f6d8d93" as `0x${string}`;
  const BOB_PK = "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as `0x${string}`;
  const CAROL_PK = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as `0x${string}`;

  const aliceWallet = makeWallet(ALICE_PK);
  const bobWallet = makeWallet(BOB_PK);
  const carolWallet = makeWallet(CAROL_PK);

  const aliceEns = "alice.agents.parent.eth";
  const bobEns = "bob.agents.parent.eth";
  const carolEns = "carol.agents.parent.eth";

  const aliceKP = generateKeyPair();
  const bobKP = generateKeyPair();
  const carolKP = generateKeyPair();

  const storage = new MemoryStorage();

  step("1. Alice mints biome demo.biome.eth with 3 members");
  const K = nacl.randomBytes(32);
  const members = [
    { ens: aliceEns, pubkey: aliceKP.publicKey },
    { ens: bobEns, pubkey: bobKP.publicKey },
    { ens: carolEns, pubkey: carolKP.publicKey },
  ];
  const unsigned = buildUnsignedBiomeDoc({
    name: "demo.biome.eth",
    goal: "demo",
    members,
    ownerEns: aliceEns,
    ownerPubkey: aliceKP.publicKey,
    ownerSecretKey: aliceKP.secretKey,
    version: 1,
    K,
    createdAt: Math.floor(Date.now() / 1000),
  });
  const sig = await signEIP191(aliceWallet, biomeSigningPayload(unsigned));
  const doc: BiomeDoc = { ...unsigned, sig };
  const root = await storage.uploadBlob(new TextEncoder().encode(JSON.stringify(doc)));
  ok(`biome doc uploaded → root ${short(root)}`);
  info(`members: ${members.map((m) => m.ens).join(", ")}`);

  step("2. Bob and Carol join — verify owner sig and unwrap K");
  for (const [ens, wallet, kp] of [
    [bobEns, bobWallet, bobKP],
    [carolEns, carolWallet, carolKP],
  ] as const) {
    const bytes = await storage.downloadBlob(root);
    const loaded = JSON.parse(new TextDecoder().decode(bytes)) as BiomeDoc;
    const { sig: s, ...unsignedLoaded } = loaded;
    const sigOk = await verifyEIP191(
      aliceWallet.account.address,
      biomeSigningPayload(unsignedLoaded),
      s,
    );
    if (!sigOk) throw new Error(`doc signature invalid for ${ens}`);
    const wrap = loaded.wraps[ens];
    if (!wrap) throw new Error(`no wrap for ${ens}`);
    const Kgot = unwrapKey(wrap, loaded.ownerPubkey, kp.secretKey);
    if (!eqBytes(Kgot, K)) throw new Error(`${ens} derived wrong K`);
    ok(`${ens} verified owner sig and derived the same K`);
  }

  step("3. Bob sends a biome message; Alice + Carol decrypt + verify sig");
  const env1 = await buildBiomeEnvelope(
    {
      fromEns: bobEns,
      biomeName: "demo.biome.eth",
      biomeVersion: 1,
      biomeRoot: root,
      payload: "hello biome, bob here",
      K,
    },
    bobWallet,
  );
  const envRoot1 = await storage.uploadBlob(serializeEnvelope(env1));
  ok(`bob uploaded envelope v${env1.v} → root ${short(envRoot1)}`);

  const walletsByEns = {
    [aliceEns]: aliceWallet,
    [bobEns]: bobWallet,
    [carolEns]: carolWallet,
  };
  for (const [ens, _kp] of [[aliceEns, aliceKP], [carolEns, carolKP]] as const) {
    const envBytes = await storage.downloadBlob(envRoot1);
    const env = parseEnvelope(envBytes);
    const senderAddress = walletsByEns[env.from].account.address;
    const { sig: s, ...unsignedEnv } = env;
    const sigOk = await verifyEIP191(senderAddress, envelopeSigningPayload(unsignedEnv), s);
    if (!sigOk) throw new Error(`bad signature on envelope for reader ${ens}`);
    const text = decryptBiomePayload(env.ciphertext, env.nonce, K);
    ok(`${ens} decrypted: "${text}"`);
  }

  step("4. Chunk-3 history manifest: chain Bob's first message");
  const { root: histRoot1 } = await buildHistoryManifest({
    entries: [{ ts: env1.ts, from: bobEns, rootHash: envRoot1 }],
    createdBy: bobEns,
    wallet: bobWallet,
    encrypt: { kind: "biome", K },
    storage,
  });
  ok(`history manifest 1 → ${short(histRoot1)}`);

  step("5. Alice removes Carol — version bumps, fresh K rotated to survivors");
  const Knew = nacl.randomBytes(32);
  const survivors = [
    { ens: aliceEns, pubkey: aliceKP.publicKey },
    { ens: bobEns, pubkey: bobKP.publicKey },
  ];
  const unsigned2 = buildUnsignedBiomeDoc({
    name: "demo.biome.eth",
    goal: "demo",
    members: survivors,
    ownerEns: aliceEns,
    ownerPubkey: aliceKP.publicKey,
    ownerSecretKey: aliceKP.secretKey,
    version: 2,
    K: Knew,
    createdAt: Math.floor(Date.now() / 1000),
  });
  const sig2 = await signEIP191(aliceWallet, biomeSigningPayload(unsigned2));
  const doc2: BiomeDoc = { ...unsigned2, sig: sig2 };
  const root2 = await storage.uploadBlob(new TextEncoder().encode(JSON.stringify(doc2)));
  ok(`biome v2 uploaded → root ${short(root2)} (carol no longer wrapped)`);

  step("6. Bob posts under v2; verify Carol locked out, Bob still works");
  const env2 = await buildBiomeEnvelope(
    {
      fromEns: bobEns,
      biomeName: "demo.biome.eth",
      biomeVersion: 2,
      biomeRoot: root2,
      payload: "post-removal secret only survivors should read",
      K: Knew,
      history: histRoot1,
    },
    bobWallet,
  );
  const envRoot2 = await storage.uploadBlob(serializeEnvelope(env2));
  ok(`bob uploaded post-removal envelope → root ${short(envRoot2)}`);

  const env2Bytes = await storage.downloadBlob(envRoot2);
  const env2Parsed = parseEnvelope(env2Bytes);
  let carolLocked = false;
  try {
    decryptBiomePayload(env2Parsed.ciphertext, env2Parsed.nonce, K);
  } catch {
    carolLocked = true;
  }
  if (!carolLocked) {
    throw new Error("SECURITY: Carol decrypted post-removal envelope with old K");
  }
  ok("carol failed to decrypt with old K (expected)");

  const bobText = decryptBiomePayload(env2Parsed.ciphertext, env2Parsed.nonce, Knew);
  ok(`bob decrypted with Knew: "${bobText}"`);

  step("7. Walk history chain — confirm chunk-3 manifest is readable");
  const { root: histRoot2 } = await buildHistoryManifest({
    entries: [{ ts: env2.ts, from: bobEns, rootHash: envRoot2 }],
    prev: histRoot1,
    createdBy: bobEns,
    wallet: bobWallet,
    encrypt: { kind: "biome", K: Knew },
    storage,
  });
  ok(`history manifest 2 → ${short(histRoot2)} (prev: ${short(histRoot1)})`);

  // Walk the chain. Note: histRoot1 is encrypted with old K, histRoot2 with new K —
  // a real survivor would rekey-walk; for the demo we walk just the latest manifest.
  let walked = 0;
  for await (const entry of walkHistory(
    histRoot2,
    { kind: "biome", K: Knew },
    storage,
    { maxDepth: 1 },
  )) {
    walked++;
    info(`  entry ${walked}: from=${entry.from} root=${short(entry.rootHash)}`);
  }
  ok(`walked ${walked} entry from latest history manifest`);
}
