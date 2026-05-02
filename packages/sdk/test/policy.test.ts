import { describe, it, expect, vi } from "vitest";
import {
  defaultPolicy,
  resolveBiomePolicy,
  mergePolicy,
  assertSendAllowed,
  assertReceiveAllowed,
  assertBridgeAllowed,
  PolicyDeniedError,
} from "../src/policy";

// Mock the modules the client reaches through after the policy gate. Each
// stub throws `__transport_reached__` so the integration tests can assert
// that policy *let the call through* without needing a live network.
vi.mock("../src/ens", () => ({
  resolveAgent: vi
    .fn()
    .mockRejectedValue(new Error("__transport_reached__:resolveAgent")),
  setAgentRecords: vi.fn(),
  resolveBiomeRecords: vi
    .fn()
    .mockRejectedValue(new Error("__transport_reached__:resolveBiomeRecords")),
  setBiomeRecords: vi.fn(),
}));

vi.mock("../src/biome", async () => {
  const actual =
    await vi.importActual<typeof import("../src/biome")>("../src/biome");
  return {
    ...actual,
    joinBiome: vi
      .fn()
      .mockRejectedValue(new Error("__transport_reached__:joinBiome")),
  };
});

import { Hermes, type HermesConfig, type PolicyDropInfo } from "../src/client";

// ---- pure policy module tests ---------------------------------------------

describe("defaultPolicy", () => {
  it("denies all bridging by default", () => {
    const p = defaultPolicy();
    expect(p.biomeDefaults.canForwardFromPublic).toBe(false);
    expect(p.biomeDefaults.canForwardToPublic).toBe(false);
    expect(p.biomeDefaults.canBridgeToBiome).toEqual({});

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "public" },
        to: { kind: "biome", name: "biome-a.eth" },
      }),
    ).toThrow(PolicyDeniedError);

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "biome", name: "biome-a.eth" },
        to: { kind: "public", peer: "bob.eth" },
      }),
    ).toThrow(PolicyDeniedError);

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "biome", name: "biome-a.eth" },
        to: { kind: "biome", name: "biome-b.eth" },
      }),
    ).toThrow(PolicyDeniedError);
  });

  it("allows public receive/send + biome read/post out of the box", () => {
    const p = defaultPolicy();
    expect(() =>
      assertReceiveAllowed(p, { channel: { kind: "public" } }),
    ).not.toThrow();
    expect(() =>
      assertReceiveAllowed(p, { channel: { kind: "biome", name: "x.eth" } }),
    ).not.toThrow();
    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "biome", name: "x.eth" },
      }),
    ).not.toThrow();
  });
});

describe("canStartConversations", () => {
  it("blocks cold sends, allows replies when prior inbound exists", () => {
    const p = defaultPolicy();

    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "public", peer: "alice.eth" },
        hasPriorInbound: false,
      }),
    ).toThrow(/canStartConversations/);

    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "public", peer: "alice.eth" },
        hasPriorInbound: true,
      }),
    ).not.toThrow();
  });

  it("permits cold sends once explicitly enabled", () => {
    const p = mergePolicy(defaultPolicy(), {
      public: { canStartConversations: true },
    });
    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "public", peer: "alice.eth" },
        hasPriorInbound: false,
      }),
    ).not.toThrow();
  });
});

describe("per-biome overrides", () => {
  it("canPost: false on one biome leaves others untouched", () => {
    const p = mergePolicy(defaultPolicy(), {
      biomes: { "muted.eth": { canPost: false } },
    });

    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "biome", name: "muted.eth" },
      }),
    ).toThrow(/biome\.canPost/);

    expect(() =>
      assertSendAllowed(p, {
        channel: { kind: "biome", name: "other.eth" },
      }),
    ).not.toThrow();

    expect(resolveBiomePolicy(p, "other.eth").canPost).toBe(true);
  });

  it("sparse override merges over biomeDefaults", () => {
    const p = mergePolicy(defaultPolicy(), {
      biomes: { "x.eth": { canRead: false } },
    });
    const resolved = resolveBiomePolicy(p, "x.eth");
    expect(resolved.canRead).toBe(false);
    expect(resolved.canPost).toBe(true); // inherited
  });
});

describe("bridge permissions", () => {
  it("allows public→biomeA when canForwardFromPublic is true on biomeA, denies biomeB with default", () => {
    const p = mergePolicy(defaultPolicy(), {
      biomes: { "biome-a.eth": { canForwardFromPublic: true } },
    });

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "public" },
        to: { kind: "biome", name: "biome-a.eth" },
      }),
    ).not.toThrow();

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "public" },
        to: { kind: "biome", name: "biome-b.eth" },
      }),
    ).toThrow(/canForwardFromPublic/);
  });

  it("biome→biome respects per-target whitelist", () => {
    const p = mergePolicy(defaultPolicy(), {
      biomes: {
        "biome-a.eth": { canBridgeToBiome: { "biome-b.eth": true } },
      },
    });

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "biome", name: "biome-a.eth" },
        to: { kind: "biome", name: "biome-b.eth" },
      }),
    ).not.toThrow();

    expect(() =>
      assertBridgeAllowed(p, {
        from: { kind: "biome", name: "biome-a.eth" },
        to: { kind: "biome", name: "biome-c.eth" },
      }),
    ).toThrow(/canBridgeToBiome/);
  });
});

describe("mergePolicy", () => {
  it("preserves base flags not mentioned in patch", () => {
    const base = defaultPolicy();
    const merged = mergePolicy(base, {
      public: { canStartConversations: true },
    });
    expect(merged.public.canStartConversations).toBe(true);
    expect(merged.public.canSend).toBe(true);
    expect(merged.public.canReceive).toBe(true);
  });

  it("biome overrides accumulate across calls", () => {
    let p = defaultPolicy();
    p = mergePolicy(p, { biomes: { "x.eth": { canPost: false } } });
    p = mergePolicy(p, {
      biomes: { "x.eth": { canBridgeToBiome: { "y.eth": true } } },
    });
    expect(p.biomes["x.eth"]).toMatchObject({
      canPost: false,
      canBridgeToBiome: { "y.eth": true },
    });
  });

  it("null in `biomes` patch removes the override", () => {
    let p = mergePolicy(defaultPolicy(), {
      biomes: { "x.eth": { canPost: false } },
    });
    expect(p.biomes["x.eth"]).toBeDefined();
    p = mergePolicy(p, { biomes: { "x.eth": null } });
    expect(p.biomes["x.eth"]).toBeUndefined();
  });
});

// ---- client integration: receive-side denial fires onPolicyDrop -----------

describe("Hermes client policy integration", () => {
  it("fetchInbox denial drops messages and fires onPolicyDrop instead of throwing", async () => {
    const drops: PolicyDropInfo[] = [];
    const client = makeMockedClient({
      onPolicyDrop: (d) => drops.push(d),
    });

    client.updatePolicy({ public: { canReceive: false } });

    const out = await client.fetchInbox();
    expect(out).toEqual([]);
    expect(drops).toHaveLength(1);
    expect(drops[0].err).toBeInstanceOf(PolicyDeniedError);
    expect(drops[0].err.reason).toBe("public.canReceive");
    expect(drops[0].channel).toEqual({ kind: "public" });
  });

  it("fetchBiomeInbox denial reports the biome name", async () => {
    const drops: PolicyDropInfo[] = [];
    const client = makeMockedClient({
      onPolicyDrop: (d) => drops.push(d),
    });

    client.updatePolicy({ biomes: { "muted.eth": { canRead: false } } });

    const out = await client.fetchBiomeInbox("muted.eth");
    expect(out).toEqual([]);
    expect(drops).toHaveLength(1);
    expect(drops[0].err.reason).toBe("biome.canRead");
    expect(drops[0].channel).toEqual({ kind: "biome", name: "muted.eth" });
  });

  it("send throws PolicyDeniedError on cold send with default policy", async () => {
    const client = makeMockedClient({});
    await expect(client.send("alice.eth", "hi")).rejects.toThrow(
      PolicyDeniedError,
    );
  });

  it("send proceeds (and hits transport) once peer is recorded as inbound", async () => {
    const client = makeMockedClient({});
    client.recordInboundPeer("alice.eth");
    // Will fail at ENS lookup (mocked to throw a sentinel) — proves the policy
    // gate let the call through.
    await expect(client.send("alice.eth", "hi")).rejects.toThrow(
      /__transport_reached__/,
    );
  });

  it("bridge(public→biome) is denied by default, allowed after explicit grant", async () => {
    const client = makeMockedClient({});

    await expect(
      client.bridge({
        from: { kind: "public" },
        to: { kind: "biome", name: "biome-a.eth" },
        message: "hello",
      }),
    ).rejects.toThrow(/canForwardFromPublic/);

    client.updatePolicy({
      biomes: { "biome-a.eth": { canForwardFromPublic: true } },
    });

    // Bridge gate now passes; the inner sendToBiome trips the mocked transport
    // sentinel (which is the proof we got past every policy check).
    await expect(
      client.bridge({
        from: { kind: "public" },
        to: { kind: "biome", name: "biome-a.eth" },
        message: "hello",
      }),
    ).rejects.toThrow(/__transport_reached__/);
  });
});

// ---- helpers --------------------------------------------------------------

function makeMockedClient(overrides: Partial<HermesConfig>): Hermes {
  // Build a Hermes instance with stub transport. The keystore path is omitted
  // so persist() is a no-op. We bypass `register()` by setting the private
  // `keys` field via prototype hackery — simpler than wiring a full keypair
  // round-trip into every test.
  const cfg: HermesConfig = {
    ensName: "self.eth",
    inboxContract: "0x0000000000000000000000000000000000000001",

    publicClient: {
      // readInbox path: return zero logs so the loop is a no-op.
      getLogs: vi.fn().mockResolvedValue([]),
    } as any,
    wallet: {
      account: { address: "0x000000000000000000000000000000000000dEaD" },
      writeContract: vi.fn().mockResolvedValue("0xtx" as `0x${string}`),
      signMessage: vi
        .fn()
        .mockRejectedValue(new Error("__transport_reached__")),
    } as any,
    storage: {
      rpcUrl: "x",
      indexerUrl: "y",
      privateKey:
        "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    } as any,
    ...overrides,
  };
  const client = new Hermes(cfg);
  // Inject a stub keypair so policy gates execute (they run after the keys
  // check). The keys themselves are never exercised in these tests because
  // every transport path is stubbed to throw.
  (client as unknown as { keys: unknown }).keys = {
    publicKey: "stub",
    secretKey: "stub",
  };
  return client;
}
