import { useState, useEffect } from "react";
import { resolveBiomeRecords, readInbox, type InboxMessage, type InboxConfig } from "hermes-agents-sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import { downloadBlob } from "@/lib/browserStorage";

const inboxConfig: InboxConfig = {
  contract: INBOX_CONTRACT,
  publicClient,
};

export type BiomeState = {
  root: `0x${string}` | null;
  version: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  doc: any | null;
  messages: InboxMessage[];
  loading: boolean;
  error: string | null;
};

export function useBiome(name: string | undefined) {
  const [state, setState] = useState<BiomeState>({
    root: null,
    version: null,
    doc: null,
    messages: [],
    loading: false,
    error: null,
  });

  useEffect(() => {
    if (!name) return;
    let cancelled = false;

    async function load() {
      setState((s) => ({ ...s, loading: true, error: null }));
      try {
        // 1. Resolve ENS biome records
        const { root, version } = await resolveBiomeRecords(name!, publicClient);
        if (cancelled) return;

        // 2. Download BiomeDoc from 0G
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        let doc: any = null;
        try {
          const bytes = await downloadBlob(root);
          const text = new TextDecoder().decode(bytes);
          doc = JSON.parse(text);
        } catch {
          // biome doc not yet on 0G or parsing failed
        }

        // 3. Read inbox events
        const messages = await readInbox(inboxConfig, name!, 0n);

        if (!cancelled) {
          setState({ root, version, doc, messages, loading: false, error: null });
        }
      } catch (err) {
        if (!cancelled) {
          setState((s) => ({ ...s, loading: false, error: (err as Error).message }));
        }
      }
    }

    load();
    const id = setInterval(load, 8000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [name]);

  return state;
}
