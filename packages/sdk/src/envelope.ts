export const ENVELOPE_VERSION = 2 as const;

export type Envelope = {
  v: 2; // bump on breaking changes
  from: string; // sender ENS
  to: string; // recipient ENS or biome name
  ts: number; // unix seconds
  nonce: string; // base64, from encryptMessage
  ciphertext: string; // base64
  ephemeralPubKey: string; // base64, sender's per-message X25519 pubkey (omitted for biome msgs)
  replyTo?: `0x${string}`; // 0G rootHash of parent msg, if this is a reply
  // v2 additions
  biome?: { name: string; version: number; root: `0x${string}` };
  context?: `0x${string}`; // 0G rootHash → ContextManifest
  history?: `0x${string}`; // 0G rootHash → HistoryManifest
  thread?: string; // sub-thread within a biome
  sig: `0x${string}`; // EIP-191 over canonicalize(envelope minus sig)
};

export type UnsignedEnvelope = Omit<Envelope, "sig">;

// v1 envelope shape, kept only for the read-side shim. Drop in v0.3.
type EnvelopeV1 = Omit<
  Envelope,
  "v" | "biome" | "context" | "history" | "thread"
> & {
  v: 1;
};

// Sorted keys, no whitespace, drop undefined. Same input → same bytes.
export function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  const parts = keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`);
  return `{${parts.join(",")}}`;
}

export function envelopeSigningPayload(env: UnsignedEnvelope): string {
  return canonicalize(env);
}

export function serializeEnvelope(env: Envelope): Uint8Array {
  return new TextEncoder().encode(canonicalize(env));
}

export function parseEnvelope(bytes: Uint8Array): Envelope {
  const obj = JSON.parse(new TextDecoder().decode(bytes));
  if (obj.v === 2) return obj as Envelope;
  if (obj.v === 1) return promoteV1(obj as EnvelopeV1);
  throw new Error(`Unsupported envelope version: ${obj.v}`);
}

function promoteV1(env: EnvelopeV1): Envelope {
  return { ...env, v: 2 };
}

// Bounded LRU of seen (from, nonce) pairs. In-memory only.
export class ReplayCache {
  private seen = new Set<string>();
  private order: string[] = [];
  constructor(private maxEntries = 10_000) {}

  check(from: string, nonce: string): boolean {
    const key = `${from}|${nonce}`;
    if (this.seen.has(key)) return true;
    this.seen.add(key);
    this.order.push(key);
    if (this.order.length > this.maxEntries) {
      const evict = this.order.shift()!;
      this.seen.delete(evict);
    }
    return false;
  }
}
