import { describe, it, expect, vi } from "vitest";
import nacl from "tweetnacl";
import { privateKeyToAccount } from "viem/accounts";
import {
  buildBiomeEnvelope,
  decryptBiomeEnvelope,
  type BiomeDoc,
} from "../src/biome";

const mocked = vi.hoisted(() => ({
  resolveAgent: vi.fn(),
}));

vi.mock("../src/ens", () => ({
  resolveAgent: mocked.resolveAgent,
  resolveBiomeRecords: vi.fn(),
  setBiomeRecords: vi.fn(),
}));

function makeWallet() {
  const account = privateKeyToAccount(
    "0x59c6995e998f97a5a0044976f7d5f74895f4e4f5fbc26f4f2f8a4e4c9f6d8d93",
  );
  return {
    account,
    signMessage: ({ message }: { message: string }) =>
      account.signMessage({ message }),
  } as any;
}

function makeDoc(senderEns: string): BiomeDoc {
  return {
    v: 1,
    name: "research.biomes.parent.eth",
    goal: "test",
    rules: {},
    members: [{ ens: senderEns, pubkey: "unused" }],
    wraps: {},
    ownerEns: senderEns,
    ownerPubkey: "unused",
    version: 1,
    createdAt: 1700000000,
    sig: "0xdeadbeef",
  };
}

describe("biome envelope helpers", () => {
  it("round-trips a biome message", async () => {
    const senderEns = "alice.agents.parent.eth";
    const wallet = makeWallet();
    const K = nacl.randomBytes(32);

    mocked.resolveAgent.mockResolvedValueOnce({
      addr: wallet.account.address,
      pubkey: "unused",
      inbox: "unused",
    });

    const env = await buildBiomeEnvelope(
      {
        fromEns: senderEns,
        biomeName: "research.biomes.parent.eth",
        biomeVersion: 1,
        biomeRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
        payload: "hello biome",
        K,
        thread: "thread-1",
      },
      wallet,
    );

    const out = await decryptBiomeEnvelope(
      env,
      K,
      makeDoc(senderEns),
      {} as any,
    );

    expect(out.text).toBe("hello biome");
    expect(out.envelope.thread).toBe("thread-1");
  });

  it("rejects tampered envelopes", async () => {
    const senderEns = "alice.agents.parent.eth";
    const wallet = makeWallet();
    const K = nacl.randomBytes(32);

    mocked.resolveAgent.mockResolvedValueOnce({
      addr: wallet.account.address,
      pubkey: "unused",
      inbox: "unused",
    });

    const env = await buildBiomeEnvelope(
      {
        fromEns: senderEns,
        biomeName: "research.biomes.parent.eth",
        biomeVersion: 1,
        biomeRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
        payload: "hello biome",
        K,
      },
      wallet,
    );

    const tampered = { ...env, ciphertext: env.ciphertext + "A" };

    await expect(
      decryptBiomeEnvelope(tampered, K, makeDoc(senderEns), {} as any),
    ).rejects.toThrow(/bad signature/);
  });

  it("rejects sender not in biome members", async () => {
    const wallet = makeWallet();
    const K = nacl.randomBytes(32);

    const env = await buildBiomeEnvelope(
      {
        fromEns: "mallory.agents.parent.eth",
        biomeName: "research.biomes.parent.eth",
        biomeVersion: 1,
        biomeRoot: ("0x" + "ab".repeat(32)) as `0x${string}`,
        payload: "intrusion",
        K,
      },
      wallet,
    );

    await expect(
      decryptBiomeEnvelope(
        env,
        K,
        makeDoc("alice.agents.parent.eth"),
        {} as any,
      ),
    ).rejects.toThrow(/not a member/);
  });
});
