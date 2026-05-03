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
} from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "./chainConfig";
import { encodeBody, newRequestId, type SelectorBody } from "./selectorEnvelopes";

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

/**
 * Public user → selector. The selector reads its own Anima as a routing
 * manifest, picks one expert, forwards the request as a sealed DM, and
 * replies back to the user with the expert's answer + a "routed to X
 * because Y" preamble + a footer letting the user DM the expert
 * directly for follow-ups.
 */
export async function submitToSelector(args: {
  selectorEns: string;
  userEns: string;
  userPubkey: string;
  userSecretKey: string;
  markdown: string;
  walletClient: WalletClient;
}): Promise<{
  requestId: string;
  rootHash: `0x${string}`;
  tx: `0x${string}`;
}> {
  const selector = await resolveAgent(args.selectorEns, publicClient);

  const requestId = newRequestId();
  const inner: SelectorBody = {
    kind: "request",
    requestId,
    markdown: args.markdown,
  };

  const { ciphertext, nonce } = encryptMessage(
    encodeBody(inner),
    selector.pubkey,
    args.userSecretKey,
  );
  const unsigned: UnsignedEnvelope = {
    v: 2,
    from: args.userEns,
    to: args.selectorEns,
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
    args.selectorEns,
    rootHash,
  );

  return { requestId, rootHash, tx };
}
