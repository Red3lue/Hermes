import { useState, useEffect, useRef } from "react";
import {
  readInbox,
  parseEnvelope,
  decryptMessage,
  resolveAgent,
} from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";
import { decodeBody, type QuorumBody } from "@/lib/quorumEnvelopes";

export type UserResponse = {
  requestId: string;
  markdown: string;
  tally: Record<string, number>;
  from: string;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

const POLL_MS = 3000;

/**
 * Polls the user's own inbox node on HermesInbox (Sepolia), downloads each
 * blob from 0G, decrypts envelopes addressed to the user, filters down to
 * `kind: "final-response"` bodies, and surfaces them keyed by requestId.
 *
 * Pure on-chain read — no agents-server coordination plane.
 */
export function useUserDmInbox(args: {
  userEns: string | null;
  userSecretKey: string | null;
}) {
  const { userEns, userSecretKey } = args;
  const [responses, setResponses] = useState<Map<string, UserResponse>>(
    new Map(),
  );
  const [error, setError] = useState<string | null>(null);

  const cursor = useRef<bigint>(0n);
  const seen = useRef<Set<string>>(new Set());
  const senderPubkeyCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    cursor.current = 0n;
    seen.current = new Set();
    senderPubkeyCache.current = new Map();
    setResponses(new Map());
    setError(null);

    if (!userEns || !userSecretKey) return;
    let stopped = false;

    async function getSenderPubkey(ens: string): Promise<string | null> {
      const cached = senderPubkeyCache.current.get(ens);
      if (cached) return cached;
      try {
        const a = await resolveAgent(ens, publicClient);
        senderPubkeyCache.current.set(ens, a.pubkey);
        return a.pubkey;
      } catch {
        return null;
      }
    }

    async function processLog(log: {
      rootHash: `0x${string}`;
      blockNumber: bigint;
      transactionHash: `0x${string}`;
    }) {
      try {
        const bytes = await downloadBlob(log.rootHash);
        let env;
        try {
          env = parseEnvelope(bytes);
        } catch {
          return;
        }
        if (env.to !== userEns || env.biome) return;
        // Need the sender's X25519 pubkey to open the sealed box. Prefer the
        // ephemeralPubKey on the envelope (set by the SDK on 1:1 sends);
        // fall back to ENS.
        const senderPub =
          env.ephemeralPubKey ?? (await getSenderPubkey(env.from));
        if (!senderPub) return;
        let plaintext: string;
        try {
          plaintext = decryptMessage(
            env.ciphertext,
            env.nonce,
            senderPub,
            userSecretKey!,
          );
        } catch {
          return;
        }
        const body = decodeBody(plaintext) as QuorumBody | null;
        if (!body || body.kind !== "final-response") return;

        const ev: UserResponse = {
          requestId: body.requestId,
          markdown: body.markdown,
          tally: body.tally,
          from: env.from,
          ts: env.ts * 1000,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          rootHash: log.rootHash,
        };
        setResponses((prev) => {
          const next = new Map(prev);
          next.set(ev.requestId, ev);
          return next;
        });
      } catch (err) {
        console.warn(
          `[useUserDmInbox] drop ${log.rootHash.slice(0, 10)}…:`,
          (err as Error).message,
        );
      }
    }

    async function tick() {
      if (stopped) return;
      try {
        const logs = await readInbox(
          { contract: INBOX_CONTRACT, publicClient },
          userEns!,
          cursor.current,
        );
        for (const log of logs) {
          if (seen.current.has(log.rootHash)) continue;
          seen.current.add(log.rootHash);
          if (log.blockNumber > cursor.current) cursor.current = log.blockNumber;
          await processLog(log);
        }
      } catch (err) {
        if (!stopped) setError((err as Error).message);
      }
      if (!stopped) setTimeout(tick, POLL_MS);
    }

    tick();
    return () => {
      stopped = true;
    };
  }, [userEns, userSecretKey]);

  return { responses, error };
}
