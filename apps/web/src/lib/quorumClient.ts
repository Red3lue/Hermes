import type { WalletClient } from "viem";
import {
  buildBiomeEnvelope,
  serializeEnvelope,
  resolveBiomeRecords,
  unwrapKey,
  appendToInbox,
  type BiomeDoc,
} from "@hermes/sdk";
import { publicClient, INBOX_CONTRACT } from "./chainConfig";
import { downloadBlob } from "./browserStorage";
import { encodeBody, newContextId, type QuorumBody } from "./quorumEnvelopes";

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

// Upload a blob via the agents-server 0G proxy. Deployer pays the 0G fee.
async function uploadViaProxy(bytes: Uint8Array): Promise<`0x${string}`> {
  const r = await fetch(`${BASE}/blob`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    // Cast: ArrayBufferView is a valid BodyInit; viem's bytes type includes it
    body: bytes as BodyInit,
  });
  if (!r.ok) throw new Error(`proxy upload → ${r.status}`);
  const j = (await r.json()) as { rootHash: `0x${string}` };
  return j.rootHash;
}

/**
 * Owner-side: submit a context envelope to the biome inbox. Returns the
 * contextId so the caller can correlate with the on-chain stage timeline.
 *
 * Flow:
 *   1. Build a biome envelope (sealed with biome key K, signed by owner).
 *   2. Upload sealed bytes to 0G via proxy.
 *   3. HermesInbox.send(node(biome), rootHash) — owner pays Sepolia gas.
 */
export async function submitContext(args: {
  biomeName: string;
  ownerEns: string;
  ownerSecretKey: string; // base64 X25519 secret (derived from sig)
  markdown: string;
  walletClient: WalletClient;
}): Promise<{ contextId: string; rootHash: `0x${string}`; tx: `0x${string}` }> {
  const { biomeName, ownerEns, ownerSecretKey, markdown, walletClient } = args;

  // 1. Resolve biome on chain + download BiomeDoc + unwrap K
  const { root, version } = await resolveBiomeRecords(biomeName, publicClient);
  const docBytes = await downloadBlob(root);
  const doc = JSON.parse(new TextDecoder().decode(docBytes)) as BiomeDoc;
  const wrap = doc.wraps?.[ownerEns];
  if (!wrap) {
    throw new Error(
      `${ownerEns} is not a member of ${biomeName} — no wrap available`,
    );
  }
  const K = unwrapKey(wrap, doc.ownerPubkey, ownerSecretKey);

  // 2. Build inner QuorumBody, encode as JSON, then build the biome envelope
  const contextId = newContextId();
  const inner: QuorumBody = {
    kind: "context",
    biomeName,
    markdown,
    contextId,
  };
  const env = await buildBiomeEnvelope(
    {
      fromEns: ownerEns,
      biomeName,
      biomeVersion: version,
      biomeRoot: root,
      payload: encodeBody(inner),
      K,
    },
    walletClient as never,
  );

  // 3. Upload sealed envelope to 0G
  const rootHash = await uploadViaProxy(serializeEnvelope(env));

  // 4. Append to HermesInbox (Sepolia tx, paid by user)
  const tx = await appendToInbox(
    {
      contract: INBOX_CONTRACT,
      publicClient,
      wallet: walletClient as never,
    },
    biomeName,
    rootHash,
  );

  return { contextId, rootHash, tx };
}

/**
 * Fallback submission for demo: upload plaintext QuorumBody to 0G proxy
 * and append the resulting rootHash to the biome inbox. This avoids
 * requiring the sender to be a biome member (no wrap needed).
 */
export async function submitContextViaProxy(args: {
  biomeName: string;
  markdown: string;
  walletClient: WalletClient;
}): Promise<{ contextId: string; rootHash: `0x${string}`; tx: `0x${string}` }> {
  const { biomeName, markdown, walletClient } = args;
  const contextId = newContextId();
  const inner: QuorumBody = {
    kind: "context",
    biomeName,
    markdown,
    contextId,
  };

  const bytes = new TextEncoder().encode(encodeBody(inner));
  const rootHash = await uploadViaProxy(bytes);

  const tx = await appendToInbox(
    {
      contract: INBOX_CONTRACT,
      publicClient,
      wallet: walletClient as never,
    },
    biomeName,
    rootHash,
  );

  return { contextId, rootHash, tx };
}
