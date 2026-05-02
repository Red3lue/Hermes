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

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

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

/** Send a sealed DM from the user to the concierge. Body is plain text
 * encrypted to the concierge's pubkey. The concierge runtime polls its
 * inbox, decrypts, calls the LLM with persona + per-sender history, and
 * replies via sealed DM back to the user's inbox. */
export async function sendChatMessage(args: {
  conciergeEns: string;
  userEns: string;
  userPubkey: string;
  userSecretKey: string;
  text: string;
  walletClient: WalletClient;
}): Promise<{ rootHash: `0x${string}`; tx: `0x${string}` }> {
  const concierge = await resolveAgent(args.conciergeEns, publicClient);
  const { ciphertext, nonce } = encryptMessage(
    args.text,
    concierge.pubkey,
    args.userSecretKey,
  );
  const unsigned: UnsignedEnvelope = {
    v: 2,
    from: args.userEns,
    to: args.conciergeEns,
    ts: Math.floor(Date.now() / 1000),
    nonce,
    ciphertext,
    ephemeralPubKey: args.userPubkey,
  };
  const sig = await signEIP191(
    args.walletClient as never,
    envelopeSigningPayload(unsigned),
  );
  const envelope: Envelope = { ...unsigned, sig };
  const rootHash = await uploadViaProxy(serializeEnvelope(envelope));
  const tx = await appendToInbox(
    {
      contract: INBOX_CONTRACT,
      publicClient,
      wallet: args.walletClient as never,
    },
    args.conciergeEns,
    rootHash,
  );
  return { rootHash, tx };
}
