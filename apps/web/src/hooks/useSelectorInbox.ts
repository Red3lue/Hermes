import { useState, useEffect, useRef } from "react";
import {
  readInbox,
  parseEnvelope,
  decryptMessage,
  resolveAgent,
} from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";
import { decodeBody } from "@/lib/selectorEnvelopes";

export type SelectorResponse = {
  requestId: string;
  markdown: string;
  expertEns: string;
  reason: string;
  from: string;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

const POLL_MS = 3000;

/** Polls the user's own inbox for `final-response` DMs from the
 * Selector. Decrypts with the user's secret key, decodes the inner
 * SelectorBody, and surfaces the routed reply (with the expert's ENS +
 * the routing reason). */
export function useSelectorInbox(args: {
  userEns: string | null;
  userSecretKey: string | null;
  selectorEns: string;
}) {
  const { userEns, userSecretKey, selectorEns } = args;
  const [responses, setResponses] = useState<Map<string, SelectorResponse>>(
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
        // Only surface DMs from the configured selector.
        if (env.from !== selectorEns) return;

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

        const body = decodeBody(plaintext);
        if (!body || body.kind !== "final-response") return;

        const ev: SelectorResponse = {
          requestId: body.requestId,
          markdown: body.markdown,
          expertEns: body.expertEns,
          reason: body.reason,
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
          `[useSelectorInbox] drop ${log.rootHash.slice(0, 10)}…:`,
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
          if (log.blockNumber > cursor.current)
            cursor.current = log.blockNumber;
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
  }, [userEns, userSecretKey, selectorEns]);

  return { responses, error };
}
