import { describe, it, expect } from "vitest";
import {
  canonicalize,
  envelopeSigningPayload,
  serializeEnvelope,
  parseEnvelope,
  ReplayCache,
  type Envelope,
  type UnsignedEnvelope,
} from "../src/envelope";

describe("canonicalize", () => {
  it("matches JSON.stringify for primitives", () => {
    expect(canonicalize("hi")).toBe('"hi"');
    expect(canonicalize(42)).toBe("42");
    expect(canonicalize(true)).toBe("true");
    expect(canonicalize(null)).toBe("null");
  });

  it("sorts object keys", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("produces same output regardless of insertion order", () => {
    const a = canonicalize({ to: "alice", from: "bob", ts: 1, v: 1 });
    const b = canonicalize({ v: 1, ts: 1, from: "bob", to: "alice" });
    expect(a).toBe(b);
  });

  it("recurses into nested objects", () => {
    const out = canonicalize({ outer: { z: 1, a: 2 }, first: true });
    expect(out).toBe('{"first":true,"outer":{"a":2,"z":1}}');
  });

  it("preserves array order", () => {
    expect(canonicalize([3, 1, 2])).toBe("[3,1,2]");
  });

  it("drops undefined fields", () => {
    expect(canonicalize({ a: 1, b: undefined, c: 3 })).toBe('{"a":1,"c":3}');
  });

  it("emits no whitespace", () => {
    const out = canonicalize({ a: { b: [1, 2] } });
    expect(out).not.toMatch(/\s/);
  });
});

describe("envelopeSigningPayload", () => {
  it("is stable across reordered fields", () => {
    const env1: UnsignedEnvelope = {
      v: 1,
      from: "alice.hermes.eth",
      to: "bob.hermes.eth",
      ts: 1714000000,
      nonce: "abc",
      ciphertext: "def",
      ephemeralPubKey: "xyz",
    };
    const env2: UnsignedEnvelope = {
      ephemeralPubKey: "xyz",
      ciphertext: "def",
      nonce: "abc",
      ts: 1714000000,
      to: "bob.hermes.eth",
      from: "alice.hermes.eth",
      v: 1,
    };
    expect(envelopeSigningPayload(env1)).toBe(envelopeSigningPayload(env2));
  });

  it("changes when any field changes", () => {
    const base: UnsignedEnvelope = {
      v: 1,
      from: "alice.hermes.eth",
      to: "bob.hermes.eth",
      ts: 1714000000,
      nonce: "abc",
      ciphertext: "def",
      ephemeralPubKey: "xyz",
    };
    const tampered = { ...base, ts: base.ts + 1 };
    expect(envelopeSigningPayload(base)).not.toBe(
      envelopeSigningPayload(tampered),
    );
  });

  it("includes optional replyTo when present", () => {
    const base: UnsignedEnvelope = {
      v: 1,
      from: "a.eth",
      to: "b.eth",
      ts: 1,
      nonce: "n",
      ciphertext: "c",
      ephemeralPubKey: "e",
    };
    const withReply: UnsignedEnvelope = {
      ...base,
      replyTo: ("0x" + "ab".repeat(32)) as `0x${string}`,
    };
    expect(envelopeSigningPayload(base)).not.toBe(
      envelopeSigningPayload(withReply),
    );
  });
});

describe("serialize / parse", () => {
  it("round-trips a complete envelope", () => {
    const env: Envelope = {
      v: 1,
      from: "alice.hermes.eth",
      to: "bob.hermes.eth",
      ts: 1714000000,
      nonce: "n",
      ciphertext: "c",
      ephemeralPubKey: "e",
      sig: "0xdeadbeef",
    };
    const bytes = serializeEnvelope(env);
    const parsed = parseEnvelope(bytes);
    expect(parsed).toEqual(env);
  });

  it("rejects unknown versions", () => {
    const bytes = new TextEncoder().encode('{"v":99}');
    expect(() => parseEnvelope(bytes)).toThrow(/version/);
  });
});

describe("ReplayCache", () => {
  it("returns false on first sight, true on repeat", () => {
    const cache = new ReplayCache();
    expect(cache.check("alice", "n1")).toBe(false);
    expect(cache.check("alice", "n1")).toBe(true);
  });

  it("scopes by sender", () => {
    const cache = new ReplayCache();
    cache.check("alice", "n1");
    expect(cache.check("bob", "n1")).toBe(false);
  });

  it("evicts oldest beyond maxEntries", () => {
    const cache = new ReplayCache(2);
    cache.check("a", "1");
    cache.check("a", "2");
    cache.check("a", "3"); // evicts "a|1"
    expect(cache.check("a", "1")).toBe(false);
  });
});
