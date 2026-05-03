import { useEffect, useState } from "react";
import {
  walkHistory,
  resolveAgent,
  type ManifestEntry,
} from "hermes-agents-sdk";
import { publicClient } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";

const browserStorageShim = {
  uploadBlob: async () => {
    throw new Error("walk-only storage shim: upload not allowed");
  },
  async downloadBlob(root: `0x${string}`): Promise<Uint8Array> {
    return downloadBlob(root);
  },
};

export type HistoryEntry = {
  side: "user" | "concierge";
  text: string;
  ts: number; // unix seconds (manifest entry ts)
  rootHash: `0x${string}`;
  thread?: string;
};

/** Walk both sides of a 1:1 conversation by following the latest known
 * HistoryManifest root from each party backward. Each manifest is
 * encrypted in 1:1 mode so the user holds the key; entries now include
 * `body`, so we reconstruct the full transcript without any extra
 * envelope downloads.
 *
 * Pass the latest manifest root from each side. The concierge root is
 * read off `envelope.history` of the most recent concierge reply; the
 * user root is the `historyRoot` returned from the most recent
 * `sendChatMessage` (we persist it locally per (peer, thread)). */
export function useChatHistory(args: {
  userEns: string | null;
  userPubkey: string | null;
  userSecretKey: string | null;
  conciergeEns: string;
  conciergeLatestHistoryRoot: `0x${string}` | null;
  userLatestHistoryRoot: `0x${string}` | null;
  thread?: string;
  /** When true, refetch on root changes. */
  enabled?: boolean;
}) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const {
    userEns,
    userPubkey,
    userSecretKey,
    conciergeEns,
    conciergeLatestHistoryRoot,
    userLatestHistoryRoot,
    thread,
    enabled = true,
  } = args;

  useEffect(() => {
    if (!enabled || !userEns || !userPubkey || !userSecretKey) {
      setEntries([]);
      return;
    }
    let cancelled = false;
    let createdAddrCache: { ens: string; addr: `0x${string}` }[] = [];

    async function resolveCreator(ens: string): Promise<`0x${string}`> {
      const cached = createdAddrCache.find((c) => c.ens === ens);
      if (cached) return cached.addr;
      const a = await resolveAgent(ens, publicClient);
      createdAddrCache.push({ ens, addr: a.addr });
      return a.addr;
    }

    async function walkOne(
      startRoot: `0x${string}`,
      side: "user" | "concierge",
    ): Promise<HistoryEntry[]> {
      const concierge = await resolveAgent(conciergeEns, publicClient);
      // For each chain we know what the manifest's ephemeralPubKey will be:
      //  - concierge chain: ephemeralPubKey = concierge.pubkey
      //                     decrypt with userSec + concierge.pubkey
      //  - user chain (self-archive): ephemeralPubKey = userPubkey
      //                     decrypt with userSec + userPubkey
      // In both cases, the recipient secret on the user's side is userSec;
      // box.open(ct, n, ephemeralPub, recipientSec) recovers plaintext.
      const expectedSenderPublicKey =
        side === "concierge" ? concierge.pubkey : userPubkey!;
      const decryptCtx = {
        kind: "1:1" as const,
        recipientSecretKey: userSecretKey!,
        expectedSenderPublicKey,
      };
      const out: HistoryEntry[] = [];
      try {
        for await (const e of walkHistory(
          startRoot,
          decryptCtx,
          browserStorageShim,
          { resolveCreator, maxDepth: 256 },
        )) {
          if (thread !== undefined && e.thread !== thread) continue;
          if (!e.body) continue; // legacy entry — pointer only
          out.push({
            side,
            text: e.body,
            ts: e.ts,
            rootHash: e.rootHash,
            thread: e.thread,
          });
        }
      } catch (err) {
        console.warn(
          `[useChatHistory] ${side} walk failed:`,
          (err as Error).message,
        );
      }
      return out;
    }

    async function run() {
      setLoading(true);
      setError(null);
      try {
        const tasks: Promise<HistoryEntry[]>[] = [];
        if (conciergeLatestHistoryRoot) {
          tasks.push(walkOne(conciergeLatestHistoryRoot, "concierge"));
        }
        if (userLatestHistoryRoot) {
          tasks.push(walkOne(userLatestHistoryRoot, "user"));
        }
        const results = await Promise.all(tasks);
        if (cancelled) return;
        const flat = results.flat();
        flat.sort((a, b) => a.ts - b.ts || a.rootHash.localeCompare(b.rootHash));
        setEntries(flat);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    run();
    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    userEns,
    userPubkey,
    userSecretKey,
    conciergeEns,
    conciergeLatestHistoryRoot,
    userLatestHistoryRoot,
    thread,
  ]);

  return { entries, loading, error };
}
