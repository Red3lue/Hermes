import { useState, useEffect, useRef, useCallback } from "react";
import {
  resolveBiomeRecords,
  unwrapKey,
  decryptBiomePayload,
  parseEnvelope,
  readInbox,
  type Envelope,
  type BiomeDoc,
} from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";
import {
  decodeBody,
  type QuorumBody,
  type QuorumStage,
} from "@/lib/quorumEnvelopes";

export type StageEvent = {
  stage: QuorumStage;
  contextId: string;
  meta: Record<string, unknown>;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

export type ContextEvent = {
  contextId: string;
  markdown: string;
  from: string;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

export type ReportEvent = {
  contextId: string;
  markdown: string;
  tally: Record<string, number>;
  ts: number;
  blockNumber: bigint;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

export type QuorumState = {
  loading: boolean;
  error: string | null;
  doc: BiomeDoc | null;
  contextEvents: ContextEvent[]; // user submissions
  stageEvents: StageEvent[]; // coordinator stage markers
  reportEvents: ReportEvent[]; // reporter outputs
};

const POLL_MS = 3000;

/**
 * Polls the biome inbox on Sepolia, downloads each blob from 0G via the
 * agents-server proxy (deployer pays 0G fees), unwraps the biome key K
 * using the user's X25519 secret, decrypts each envelope, and classifies
 * the inner QuorumBody.
 *
 * The agents-server is NOT consulted for any quorum data — only as a 0G
 * gateway. All semantic information comes from chain + 0G blobs.
 */
export function useQuorumOnChain(args: {
  biomeName: string;
  userEns: string | null;
  userSecretKey: string | null;
}) {
  const { biomeName, userEns, userSecretKey } = args;
  const [state, setState] = useState<QuorumState>({
    loading: false,
    error: null,
    doc: null,
    contextEvents: [],
    stageEvents: [],
    reportEvents: [],
  });
  const cursor = useRef<bigint>(0n);
  const seen = useRef<Set<string>>(new Set());
  const biomeKey = useRef<Uint8Array | null>(null);

  const reset = useCallback(() => {
    cursor.current = 0n;
    seen.current = new Set();
    biomeKey.current = null;
    setState({
      loading: false,
      error: null,
      doc: null,
      contextEvents: [],
      stageEvents: [],
      reportEvents: [],
    });
  }, []);

  useEffect(() => {
    reset();
    if (!biomeName || !userEns || !userSecretKey) return;

    let stopped = false;

    async function bootstrap(): Promise<{
      doc: BiomeDoc;
      K: Uint8Array;
    } | null> {
      try {
        const { root } = await resolveBiomeRecords(biomeName, publicClient);
        const bytes = await downloadBlob(root);
        const text = new TextDecoder().decode(bytes);
        const doc = JSON.parse(text) as BiomeDoc;
        const wrap = doc.wraps?.[userEns!];
        if (!wrap) {
          throw new Error(
            `you (${userEns}) are not a member of ${biomeName} — no wrap found`,
          );
        }
        const K = unwrapKey(wrap, doc.ownerPubkey, userSecretKey!);
        return { doc, K };
      } catch (err) {
        if (!stopped) {
          setState((s) => ({
            ...s,
            error: (err as Error).message,
            loading: false,
          }));
        }
        return null;
      }
    }

    async function tick() {
      if (stopped) return;
      if (!biomeKey.current) {
        const init = await bootstrap();
        if (!init) {
          setTimeout(tick, POLL_MS);
          return;
        }
        biomeKey.current = init.K;
        setState((s) => ({ ...s, doc: init.doc }));
      }
      try {
        const logs = await readInbox(
          { contract: INBOX_CONTRACT, publicClient },
          biomeName,
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
        // Network blip — keep polling
        console.warn("[useQuorumOnChain] poll error:", (err as Error).message);
      }
      if (!stopped) setTimeout(tick, POLL_MS);
    }

    async function processLog(log: {
      rootHash: `0x${string}`;
      blockNumber: bigint;
      transactionHash: `0x${string}`;
    }): Promise<void> {
      try {
        const bytes = await downloadBlob(log.rootHash);
        let env;
        try {
          env = parseEnvelope(bytes);
        } catch {
          return;
        }
        if (env.to !== biomeName || !env.biome) return;
        const text = decryptBiomePayload(
          env.ciphertext,
          env.nonce,
          biomeKey.current!,
        );
        const body = decodeBody(text);
        if (!body) return;
        ingest(body, env, log);
      } catch (err) {
        console.warn(
          `[useQuorumOnChain] drop ${log.rootHash.slice(0, 10)}…:`,
          (err as Error).message,
        );
      }
    }

    function ingest(
      body: QuorumBody,
      env: Envelope,
      log: {
        rootHash: `0x${string}`;
        blockNumber: bigint;
        transactionHash: `0x${string}`;
      },
    ) {
      if (body.kind === "context") {
        const ev: ContextEvent = {
          contextId: body.contextId,
          markdown: body.markdown,
          from: env.from,
          ts: env.ts * 1000,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          rootHash: log.rootHash,
        };
        setState((s) => ({
          ...s,
          contextEvents: [
            ...s.contextEvents.filter((c) => c.contextId !== ev.contextId),
            ev,
          ],
        }));
      } else if (body.kind === "stage") {
        const ev: StageEvent = {
          stage: body.stage,
          contextId: body.contextId,
          meta: body.meta,
          ts: env.ts * 1000,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          rootHash: log.rootHash,
        };
        setState((s) => ({
          ...s,
          stageEvents: [...s.stageEvents, ev].sort(
            (a, b) => a.ts - b.ts || Number(a.blockNumber - b.blockNumber),
          ),
        }));
      } else if (body.kind === "report") {
        const ev: ReportEvent = {
          contextId: body.contextId,
          markdown: body.markdown,
          tally: body.tally,
          ts: env.ts * 1000,
          blockNumber: log.blockNumber,
          txHash: log.transactionHash,
          rootHash: log.rootHash,
        };
        setState((s) => ({
          ...s,
          reportEvents: [
            ...s.reportEvents.filter((r) => r.contextId !== ev.contextId),
            ev,
          ],
        }));
      }
      // bundle/deliberate/verdict are DMs (not biome broadcasts) so they
      // don't appear here.
    }

    setState((s) => ({ ...s, loading: true }));
    tick();

    return () => {
      stopped = true;
    };
  }, [biomeName, userEns, userSecretKey, reset]);

  return state;
}
