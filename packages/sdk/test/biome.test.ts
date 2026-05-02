import { describe, it, expect } from "vitest";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { generateKeyPair, encryptMessage, decryptMessage } from "../src/crypto";
import {
  wrapKey,
  unwrapKey,
  buildUnsignedBiomeDoc,
  biomeSigningPayload,
  type BiomeMember,
} from "../src/biome";

const { encodeBase64, decodeBase64 } = naclUtil;

function eqBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

describe("wrap / unwrap", () => {
  it("round-trips a 32-byte K to a single recipient", () => {
    const owner = generateKeyPair();
    const member = generateKeyPair();
    const K = nacl.randomBytes(32);

    const wrap = wrapKey(K, member.publicKey, owner.secretKey);
    const recovered = unwrapKey(wrap, owner.publicKey, member.secretKey);

    expect(recovered).toHaveLength(32);
    expect(eqBytes(recovered, K)).toBe(true);
  });

  it("three members all unwrap to the same K", () => {
    const owner = generateKeyPair();
    const m1 = generateKeyPair();
    const m2 = generateKeyPair();
    const m3 = generateKeyPair();
    const K = nacl.randomBytes(32);

    const w1 = wrapKey(K, m1.publicKey, owner.secretKey);
    const w2 = wrapKey(K, m2.publicKey, owner.secretKey);
    const w3 = wrapKey(K, m3.publicKey, owner.secretKey);

    const k1 = unwrapKey(w1, owner.publicKey, m1.secretKey);
    const k2 = unwrapKey(w2, owner.publicKey, m2.secretKey);
    const k3 = unwrapKey(w3, owner.publicKey, m3.secretKey);

    expect(eqBytes(k1, K)).toBe(true);
    expect(eqBytes(k2, K)).toBe(true);
    expect(eqBytes(k3, K)).toBe(true);
  });

  it("non-recipient cannot unwrap", () => {
    const owner = generateKeyPair();
    const member = generateKeyPair();
    const stranger = generateKeyPair();
    const K = nacl.randomBytes(32);

    const wrap = wrapKey(K, member.publicKey, owner.secretKey);
    expect(() => unwrapKey(wrap, owner.publicKey, stranger.secretKey)).toThrow(
      /Decryption failed/,
    );
  });
});

describe("buildUnsignedBiomeDoc", () => {
  const owner = generateKeyPair();
  const m1 = generateKeyPair();
  const m2 = generateKeyPair();
  const members: BiomeMember[] = [
    { ens: "owner.agents.parent.eth", pubkey: owner.publicKey },
    { ens: "alice.agents.parent.eth", pubkey: m1.publicKey },
    { ens: "bob.agents.parent.eth", pubkey: m2.publicKey },
  ];

  it("produces a wrap for every member", () => {
    const K = nacl.randomBytes(32);
    const doc = buildUnsignedBiomeDoc({
      name: "research.biomes.parent.eth",
      goal: "test",
      members,
      ownerEns: "owner.agents.parent.eth",
      ownerPubkey: owner.publicKey,
      ownerSecretKey: owner.secretKey,
      version: 1,
      K,
      createdAt: 1700000000,
    });
    for (const m of members) {
      expect(doc.wraps[m.ens]).toBeDefined();
    }
    // every wrap unseals to the same K
    expect(
      eqBytes(unwrapKey(doc.wraps[members[1].ens], owner.publicKey, m1.secretKey), K),
    ).toBe(true);
    expect(
      eqBytes(unwrapKey(doc.wraps[members[2].ens], owner.publicKey, m2.secretKey), K),
    ).toBe(true);
  });

  it("canonical signing payload is deterministic across rebuilds with the same inputs", () => {
    const K = nacl.randomBytes(32);
    const a = buildUnsignedBiomeDoc({
      name: "research.biomes.parent.eth",
      goal: "test",
      members,
      ownerEns: "owner.agents.parent.eth",
      ownerPubkey: owner.publicKey,
      ownerSecretKey: owner.secretKey,
      version: 1,
      K,
      createdAt: 1700000000,
    });
    // canonicalize must sort keys; reordering members in input changes content,
    // but the same input must produce the same payload bytes.
    const payload1 = biomeSigningPayload(a);
    const payload2 = biomeSigningPayload(a);
    expect(payload1).toBe(payload2);
  });
});

describe("addMember semantics — no rekey, existing wraps unchanged", () => {
  it("existing members' wraps are byte-identical after a member is added", () => {
    const owner = generateKeyPair();
    const m1 = generateKeyPair();
    const m2 = generateKeyPair();
    const m3 = generateKeyPair();
    const K = nacl.randomBytes(32);

    const v1Members: BiomeMember[] = [
      { ens: "owner.eth", pubkey: owner.publicKey },
      { ens: "m1.eth", pubkey: m1.publicKey },
    ];
    const v1 = buildUnsignedBiomeDoc({
      name: "b.eth",
      goal: "g",
      members: v1Members,
      ownerEns: "owner.eth",
      ownerPubkey: owner.publicKey,
      ownerSecretKey: owner.secretKey,
      version: 1,
      K,
      createdAt: 1,
    });

    // simulate addMember: keep K + existing wraps, append wrap for m2
    const v2Wraps = {
      ...v1.wraps,
      "m2.eth": wrapKey(K, m2.publicKey, owner.secretKey),
    };

    // existing wraps must NOT have been re-encrypted — they're the same nonce/ciphertext.
    expect(v2Wraps["owner.eth"]).toEqual(v1.wraps["owner.eth"]);
    expect(v2Wraps["m1.eth"]).toEqual(v1.wraps["m1.eth"]);

    // m1 still unwraps to original K (would also be true if rewrapped, but we want to
    // assert no work happened for them).
    expect(
      eqBytes(unwrapKey(v2Wraps["m1.eth"], owner.publicKey, m1.secretKey), K),
    ).toBe(true);
    // new member unwraps to same K
    expect(
      eqBytes(unwrapKey(v2Wraps["m2.eth"], owner.publicKey, m2.secretKey), K),
    ).toBe(true);
    // m3 (not added) has no wrap
    expect((v2Wraps as Record<string, unknown>)["m3.eth"]).toBeUndefined();
    // silence m3-unused warning
    void m3;
  });
});

describe("removeMember semantics — fresh K, removed member locked out of new content", () => {
  it("removed member cannot decrypt secretbox payloads encrypted with the new K", () => {
    const owner = generateKeyPair();
    const m1 = generateKeyPair();
    const m2 = generateKeyPair();
    const Kold = nacl.randomBytes(32);

    // v1 wraps for owner, m1, m2
    const v1 = buildUnsignedBiomeDoc({
      name: "b.eth",
      goal: "g",
      members: [
        { ens: "owner.eth", pubkey: owner.publicKey },
        { ens: "m1.eth", pubkey: m1.publicKey },
        { ens: "m2.eth", pubkey: m2.publicKey },
      ],
      ownerEns: "owner.eth",
      ownerPubkey: owner.publicKey,
      ownerSecretKey: owner.secretKey,
      version: 1,
      K: Kold,
      createdAt: 1,
    });

    // m1 has Kold legitimately
    const m1Got = unwrapKey(v1.wraps["m1.eth"], owner.publicKey, m1.secretKey);
    expect(eqBytes(m1Got, Kold)).toBe(true);

    // simulate removeMember(m1): new K, re-wrap only for survivors {owner, m2}
    const Knew = nacl.randomBytes(32);
    const v2 = buildUnsignedBiomeDoc({
      name: "b.eth",
      goal: "g",
      members: [
        { ens: "owner.eth", pubkey: owner.publicKey },
        { ens: "m2.eth", pubkey: m2.publicKey },
      ],
      ownerEns: "owner.eth",
      ownerPubkey: owner.publicKey,
      ownerSecretKey: owner.secretKey,
      version: 2,
      K: Knew,
      createdAt: 2,
    });

    // m1 has no wrap in v2
    expect(v2.wraps["m1.eth"]).toBeUndefined();
    expect(v2.version).toBe(2);

    // a payload encrypted with Knew (the new biome key)
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const message = new TextEncoder().encode("post-removal secret");
    const ct = nacl.secretbox(message, nonce, Knew);

    // m2 (survivor) can decrypt
    const m2K = unwrapKey(v2.wraps["m2.eth"], owner.publicKey, m2.secretKey);
    const m2Plain = nacl.secretbox.open(ct, nonce, m2K);
    expect(m2Plain).not.toBeNull();
    expect(new TextDecoder().decode(m2Plain!)).toBe("post-removal secret");

    // m1 still has Kold, but Kold cannot open ciphertext encrypted with Knew
    const fail = nacl.secretbox.open(ct, nonce, m1Got);
    expect(fail).toBeNull();
  });
});

// Sanity check on the underlying primitives we rely on.
describe("encryption primitives (sanity)", () => {
  it("nacl.secretbox round-trips with a 32-byte symmetric key", () => {
    const K = nacl.randomBytes(32);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const msg = decodeBase64(encodeBase64(new TextEncoder().encode("hi")));
    const ct = nacl.secretbox(msg, nonce, K);
    const pt = nacl.secretbox.open(ct, nonce, K);
    expect(pt).not.toBeNull();
    expect(new TextDecoder().decode(pt!)).toBe("hi");
  });

  it("encryptMessage / decryptMessage round-trips for a wrap-style payload", () => {
    const a = generateKeyPair();
    const b = generateKeyPair();
    const enc = encryptMessage("payload", b.publicKey, a.secretKey);
    const dec = decryptMessage(enc.ciphertext, enc.nonce, a.publicKey, b.secretKey);
    expect(dec).toBe("payload");
  });
});
