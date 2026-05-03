import { useState, useEffect, useRef } from "react";
import {
  readInbox,
  parseEnvelope,
  decryptMessage,
  resolveAgent,
} from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";

export type ConciergeMessage = {
  text: string;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
  thread?: string;
  history?: `0x${string}`;
};

const POLL_MS = 6000;

/** Polls the user's own inbox for sealed DMs sent by the concierge,
 * decrypts each with the user's secret key, and surfaces them in
 * timestamp order. Pure on-chain read — no agents-server coordination. */
export function useChatbotInbox(args: {
  userEns: string | null;
  userSecretKey: string | null;
  conciergeEns: string;
}) {
  const { userEns, userSecretKey, conciergeEns } = args;
  const [messages, setMessages] = useState<ConciergeMessage[]>([]);
  const [error, setError] = useState<string | null>(null);

  const cursor = useRef<bigint>(0n);
  const seen = useRef<Set<string>>(new Set());
  const senderPubkeyCache = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    cursor.current = 0n;
    seen.current = new Set();
    senderPubkeyCache.current = new Map();
    setMessages([]);
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
        // Only surface concierge replies in this view.
        if (env.from !== conciergeEns) return;

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
        const ev: ConciergeMessage = {
          text: plaintext,
          ts: env.ts * 1000,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          rootHash: log.rootHash,
          thread: env.thread,
          history: env.history,
        };
        setMessages((prev) =>
          [...prev, ev].sort(
            (a, b) =>
              a.ts - b.ts || Number(a.blockNumber - b.blockNumber),
          ),
        );
      } catch (err) {
        console.warn(
          `[useChatbotInbox] drop ${log.rootHash.slice(0, 10)}…:`,
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
  }, [userEns, userSecretKey, conciergeEns]);

  return { messages, error };
}
