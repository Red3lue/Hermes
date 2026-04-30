import { describe, expect, it } from "vitest";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";
import { generateKeyPair } from "../src/crypto";
import {
  buildContextManifest,
  buildHistoryManifest,
  loadManifest,
  mergeForkedHistories,
  walkHistory,
  type BlobStorage,
  type EncryptCtx,
  type DecryptCtx,
  type ManifestEntry,
} from "../src/manifest";

class MemoryStorage implements BlobStorage {
  private blobs = new Map<string, Uint8Array>();

  async uploadBlob(bytes: Uint8Array): Promise<`0x${string}`> {
    const hash = nacl.hash(bytes);
    const root = ("0x" +
      Buffer.from(hash.slice(0, 32)).toString("hex")) as `0x${string}`;
    this.blobs.set(root, bytes);
    return root;
  }
  async downloadBlob(root: `0x${string}`): Promise<Uint8Array> {
    const b = this.blobs.get(root);
    if (!b) throw new Error(`not found: ${root}`);
    return b;
  }
  overwrite(root: `0x${string}`, bytes: Uint8Array): void {
    this.blobs.set(root, bytes);
  }
}

function makeWallet(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return {
    account,
    signMessage: ({ message }: { message: string }) =>
      account.signMessage({ message }),
  } as any;
}

const ALICE_PK =
  "0x59c6995e998f97a5a0044976f7d5f74895f4e4f5fbc26f4f2f8a4e4c9f6d8d93" as `0x${string}`;
const BOB_PK =
  "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba" as `0x${string}`;

function biomeCtx(K: Uint8Array): {
  enc: EncryptCtx;
  dec: DecryptCtx;
} {
  return {
    enc: { kind: "biome", K },
    dec: { kind: "biome", K },
  };
}

describe("context manifest round-trip", () => {
  it("builds, uploads, loads, and verifies a context manifest (biome mode)", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const K = nacl.randomBytes(32);
    const { enc, dec } = biomeCtx(K);

    const entries: ManifestEntry[] = [
      {
        ts: 1,
        from: "alice.eth",
        rootHash: ("0x" + "11".repeat(32)) as `0x${string}`,
      },
      {
        ts: 2,
        from: "alice.eth",
        rootHash: ("0x" + "22".repeat(32)) as `0x${string}`,
      },
    ];

    const { root, manifest } = await buildContextManifest({
      entries,
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });

    expect(manifest.kind).toBe("context");
    expect(manifest.entries).toHaveLength(2);

    const loaded = await loadManifest({
      root,
      decrypt: dec,
      storage,
      expectedCreatorAddress: wallet.account.address,
    });
    expect(loaded.entries[0].rootHash).toBe(entries[0].rootHash);
  });

  it("round-trips a 1:1 context manifest using nacl-box", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const { root } = await buildContextManifest({
      entries: [
        {
          ts: 1,
          from: "alice.eth",
          rootHash: ("0x" + "ab".repeat(32)) as `0x${string}`,
        },
      ],
      createdBy: "alice.eth",
      wallet,
      encrypt: {
        kind: "1:1",
        senderPublicKey: sender.publicKey,
        senderSecretKey: sender.secretKey,
        recipientPublicKey: recipient.publicKey,
      },
      storage,
    });

    const loaded = await loadManifest({
      root,
      decrypt: {
        kind: "1:1",
        recipientSecretKey: recipient.secretKey,
        expectedSenderPublicKey: sender.publicKey,
      },
      storage,
      expectedCreatorAddress: wallet.account.address,
    });
    expect(loaded.entries[0].from).toBe("alice.eth");
  });
});

describe("history manifest walk", () => {
  it("walks a 3-message thread from latest and yields all entries in chain order", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const K = nacl.randomBytes(32);
    const { enc, dec } = biomeCtx(K);

    const e1: ManifestEntry = {
      ts: 100,
      from: "alice.eth",
      rootHash: ("0x" + "01".repeat(32)) as `0x${string}`,
    };
    const e2: ManifestEntry = {
      ts: 101,
      from: "alice.eth",
      rootHash: ("0x" + "02".repeat(32)) as `0x${string}`,
    };
    const e3: ManifestEntry = {
      ts: 102,
      from: "alice.eth",
      rootHash: ("0x" + "03".repeat(32)) as `0x${string}`,
    };

    const m1 = await buildHistoryManifest({
      entries: [e1],
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });
    const m2 = await buildHistoryManifest({
      entries: [e2],
      prev: m1.root,
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });
    const m3 = await buildHistoryManifest({
      entries: [e3],
      prev: m2.root,
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });

    const collected: ManifestEntry[] = [];
    for await (const entry of walkHistory(m3.root, dec, storage)) {
      collected.push(entry);
    }

    // newest manifest first, oldest last
    expect(collected.map((e) => e.rootHash)).toEqual([
      e3.rootHash,
      e2.rootHash,
      e1.rootHash,
    ]);
  });

  it("verifies each manifest's signature when resolveCreator is provided", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const K = nacl.randomBytes(32);
    const { enc, dec } = biomeCtx(K);

    const m1 = await buildHistoryManifest({
      entries: [
        {
          ts: 1,
          from: "alice.eth",
          rootHash: ("0x" + "01".repeat(32)) as `0x${string}`,
        },
      ],
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });

    const out: ManifestEntry[] = [];
    for await (const e of walkHistory(m1.root, dec, storage, {
      resolveCreator: async () => wallet.account.address,
    })) {
      out.push(e);
    }
    expect(out).toHaveLength(1);
  });
});

describe("manifest tampering", () => {
  it("rejects a manifest whose plaintext signature has been tampered (biome mode)", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const K = nacl.randomBytes(32);
    const { enc, dec } = biomeCtx(K);

    const { root, manifest } = await buildContextManifest({
      entries: [
        {
          ts: 1,
          from: "alice.eth",
          rootHash: ("0x" + "01".repeat(32)) as `0x${string}`,
        },
      ],
      createdBy: "alice.eth",
      wallet,
      encrypt: enc,
      storage,
    });

    // First load works without sig check.
    await loadManifest({ root, decrypt: dec, storage });

    // Tamper: re-encrypt a manifest with a forged extra entry but bogus sig.
    const forged = {
      ...manifest,
      entries: [
        ...manifest.entries,
        {
          ts: 999,
          from: "mallory.eth",
          rootHash: ("0x" + "ff".repeat(32)) as `0x${string}`,
        },
      ],
      // keep the original sig — it won't match the new payload
    };
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ct = nacl.secretbox(
      new TextEncoder().encode(JSON.stringify(forged)),
      nonce,
      K,
    );
    const tamperedBlob = {
      v: 1,
      alg: "nacl-secretbox" as const,
      nonce: Buffer.from(nonce).toString("base64"),
      ciphertext: Buffer.from(ct).toString("base64"),
    };
    storage.overwrite(
      root,
      new TextEncoder().encode(JSON.stringify(tamperedBlob)),
    );

    await expect(
      loadManifest({
        root,
        decrypt: dec,
        storage,
        expectedCreatorAddress: wallet.account.address,
      }),
    ).rejects.toThrow(/signature invalid/);
  });
});

describe("forked history merge", () => {
  it("merges two branches that fork from the same prev by (ts, from)", async () => {
    const storage = new MemoryStorage();
    const aliceWallet = makeWallet(ALICE_PK);
    const bobWallet = makeWallet(BOB_PK);
    const K = nacl.randomBytes(32);
    const { enc, dec } = biomeCtx(K);

    const root0 = await buildHistoryManifest({
      entries: [
        {
          ts: 100,
          from: "alice.eth",
          rootHash: ("0x" + "00".repeat(32)) as `0x${string}`,
        },
      ],
      createdBy: "alice.eth",
      wallet: aliceWallet,
      encrypt: enc,
      storage,
    });

    // Two forks from the same prev = root0
    const aliceFork = await buildHistoryManifest({
      entries: [
        {
          ts: 105,
          from: "alice.eth",
          rootHash: ("0x" + "0a".repeat(32)) as `0x${string}`,
        },
      ],
      prev: root0.root,
      createdBy: "alice.eth",
      wallet: aliceWallet,
      encrypt: enc,
      storage,
    });
    const bobFork = await buildHistoryManifest({
      entries: [
        {
          ts: 105,
          from: "bob.eth",
          rootHash: ("0x" + "0b".repeat(32)) as `0x${string}`,
        },
      ],
      prev: root0.root,
      createdBy: "bob.eth",
      wallet: bobWallet,
      encrypt: enc,
      storage,
    });

    const aliceBranch: ManifestEntry[] = [];
    for await (const e of walkHistory(aliceFork.root, dec, storage)) {
      aliceBranch.push(e);
    }
    const bobBranch: ManifestEntry[] = [];
    for await (const e of walkHistory(bobFork.root, dec, storage)) {
      bobBranch.push(e);
    }

    const merged = mergeForkedHistories([aliceBranch, bobBranch]);
    // Both branches share the root0 entry (ts=100); forked entries are at ts=105.
    expect(merged.map((e) => `${e.ts}:${e.from}`)).toEqual([
      "100:alice.eth",
      "100:alice.eth", // appears in both branches' walks
      "105:alice.eth",
      "105:bob.eth",
    ]);
  });
});

describe("walk safety", () => {
  it("entry-cap exceeded throws on build", async () => {
    const storage = new MemoryStorage();
    const wallet = makeWallet(ALICE_PK);
    const K = nacl.randomBytes(32);
    const { enc } = biomeCtx(K);

    const tooMany: ManifestEntry[] = Array.from({ length: 101 }, (_, i) => ({
      ts: i,
      from: "alice.eth",
      rootHash: ("0x" + "11".repeat(32)) as `0x${string}`,
    }));

    await expect(
      buildHistoryManifest({
        entries: tooMany,
        createdBy: "alice.eth",
        wallet,
        encrypt: enc,
        storage,
      }),
    ).rejects.toThrow(/cap/);
  });
});
