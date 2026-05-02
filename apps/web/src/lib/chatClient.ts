import type { WalletClient } from "viem";
import {
  resolveAgent,
  encryptMessage,
  signEIP191,
  envelopeSigningPayload,
  serializeEnvelope,
  appendToInbox,
  buildHistoryManifest,
  type Envelope,
  type UnsignedEnvelope,
  type ManifestEntry,
} from "@hermes/sdk";
import { publicClient, INBOX_CONTRACT } from "./chainConfig";
import { downloadBlob } from "./browserStorage";

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

/** Storage stub that mirrors `BlobStorage` from the SDK using the
 * deployer-paid 0G proxy for uploads and the direct 0G download path
 * for reads. The browser can't safely instantiate `ZeroGStorage`
 * (needs a private key on the signer), so this thin shim is what we
 * pass into manifest builders. */
const browserManifestStorage = {
  uploadBlob: uploadViaProxy,
  async downloadBlob(root: `0x${string}`): Promise<Uint8Array> {
    return downloadBlob(root);
  },
};

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
  /** Optional sub-thread tag — surfaced on the envelope and used by the
   * concierge to scope its per-thread history chain. */
  thread?: string;
  /** Prior history root for the user's own chain on this (concierge,
   * thread). When provided, the new manifest's `prev` points at it,
   * forming a walkable chain on the sender side. */
  priorHistoryRoot?: `0x${string}`;
  walletClient: WalletClient;
}): Promise<{
  rootHash: `0x${string}`;
  tx: `0x${string}`;
  historyRoot: `0x${string}`;
}> {
  const concierge = await resolveAgent(args.conciergeEns, publicClient);
  const { ciphertext, nonce } = encryptMessage(
    args.text,
    concierge.pubkey,
    args.userSecretKey,
  );
  const ts = Math.floor(Date.now() / 1000);
  const unsigned: UnsignedEnvelope = {
    v: 2,
    from: args.userEns,
    to: args.conciergeEns,
    ts,
    nonce,
    ciphertext,
    ephemeralPubKey: args.userPubkey,
    thread: args.thread,
    history: args.priorHistoryRoot,
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

  // Build + upload the user's HistoryManifest entry, with the plaintext
  // body baked in so future chain-walks reconstruct what the user said.
  //
  // Encryption: self-box. We pass userPubkey for BOTH sender and
  // recipient. The shared key derives to scalarmult(userSec, userPub),
  // which is the same key on both encrypt and decrypt — so only the
  // user (with their own secret) can read this chain. The concierge
  // doesn't need to read it (they already see envelopes sealed to
  // them); their own chain covers their replies.
  const entry: ManifestEntry = {
    ts,
    from: args.userEns,
    rootHash,
    thread: args.thread,
    body: args.text,
  };
  const built = await buildHistoryManifest({
    entries: [entry],
    prev: args.priorHistoryRoot,
    createdBy: args.userEns,
    wallet: args.walletClient as never,
    encrypt: {
      kind: "1:1",
      senderPublicKey: args.userPubkey,
      senderSecretKey: args.userSecretKey,
      recipientPublicKey: args.userPubkey, // self-archive
    },
    storage: browserManifestStorage,
  });

  return { rootHash, tx, historyRoot: built.root };
}
