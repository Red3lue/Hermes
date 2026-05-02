import type { WalletClient } from "viem";
import {
  resolveAgent,
  encryptMessage,
  signEIP191,
  envelopeSigningPayload,
  serializeEnvelope,
  appendToInbox,
  type Envelope,
  type UnsignedEnvelope,
} from "@hermes/sdk";
import { publicClient, INBOX_CONTRACT } from "./chainConfig";
import { encodeBody, newContextId, type QuorumBody } from "./quorumEnvelopes";

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

// Upload a blob via the agents-server 0G proxy. Deployer pays the 0G fee.
// This is the ONLY HTTP call in the user→quorum flow (besides /register-user
// during initial onboarding). Everything semantic happens on Sepolia + 0G.
async function uploadViaProxy(bytes: Uint8Array): Promise<`0x${string}`> {
  const r = await fetch(`${BASE}/blob`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as BodyInit,
  });
  if (!r.ok) throw new Error(`proxy upload → ${r.status}`);
  const j = (await r.json()) as { rootHash: `0x${string}` };
  return j.rootHash;
}

/**
 * Public user → coordinator. Builds a sealed 1:1 envelope addressed to the
 * coordinator's ENS, uploads it to 0G, and appends the rootHash to the
 * coordinator's inbox node on HermesInbox. Coordinator picks it up via its
 * polling runtime, runs the quorum round in its biome, and replies via a
 * sealed `final-response` DM back to the user's ENS.
 */
export async function submitRequestToCoordinator(args: {
  coordinatorEns: string;
  userEns: string;
  userPubkey: string; // base64 X25519
  userSecretKey: string; // base64 X25519
  markdown: string;
  walletClient: WalletClient;
}): Promise<{
  requestId: string;
  rootHash: `0x${string}`;
  tx: `0x${string}`;
}> {
  const {
    coordinatorEns,
    userEns,
    userPubkey,
    userSecretKey,
    markdown,
    walletClient,
  } = args;

  // 1. Resolve coordinator ENS → pubkey
  const coordinator = await resolveAgent(coordinatorEns, publicClient);

  // 2. Build the inner request body (the coordinator decodes this after
  //    decrypt). requestId == contextId on the coordinator side.
  const requestId = newContextId();
  const inner: QuorumBody = {
    kind: "request",
    requestId,
    markdown,
    // targetBiome omitted — coordinator routes to its single configured biome
  };

  // 3. Seal the body for the coordinator's pubkey using the user's keypair
  const { ciphertext, nonce } = encryptMessage(
    encodeBody(inner),
    coordinator.pubkey,
    userSecretKey,
  );

  // 4. Build + sign the v2 envelope
  const unsigned: UnsignedEnvelope = {
    v: 2,
    from: userEns,
    to: coordinatorEns,
    ts: Math.floor(Date.now() / 1000),
    nonce,
    ciphertext,
    ephemeralPubKey: userPubkey,
  };
  const sig = await signEIP191(
    walletClient as never,
    envelopeSigningPayload(unsigned),
  );
  const envelope: Envelope = { ...unsigned, sig };

  // 5. Upload sealed envelope to 0G (via deployer-paid proxy)
  const rootHash = await uploadViaProxy(serializeEnvelope(envelope));

  // 6. Append to HermesInbox (Sepolia tx, paid by user wallet)
  const tx = await appendToInbox(
    {
      contract: INBOX_CONTRACT,
      publicClient,
      wallet: walletClient as never,
    },
    coordinatorEns,
    rootHash,
  );

  return { requestId, rootHash, tx };
}
