import { useEffect, useRef, useState } from "react";
import { api, type TranscriptEntry } from "@/lib/api";

type StreamState = {
  entries: TranscriptEntry[];
  running: boolean;
  roundComplete: boolean;
};

export function useQuorumStream(biomeName: string) {
  const [state, setState] = useState<StreamState>({
    entries: [],
    running: false,
    roundComplete: false,
  });
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const es = new EventSource(api.quorum.streamUrl(biomeName));
    esRef.current = es;

    es.onmessage = (ev) => {
      try {
        const msg = JSON.parse(ev.data as string) as {
          type: string;
          data: unknown;
        };
        if (msg.type === "snapshot") {
          setState((s) => ({
            ...s,
            entries: msg.data as TranscriptEntry[],
          }));
        } else if (msg.type === "entry") {
          setState((s) => ({
            ...s,
            entries: [...s.entries, msg.data as TranscriptEntry],
            running: true,
            roundComplete: false,
          }));
        } else if (msg.type === "round_complete") {
          setState((s) => ({ ...s, running: false, roundComplete: true }));
        }
      } catch {
        // ignore parse errors
      }
    };

    es.onerror = () => {
      // SSE reconnects automatically; just update running state
      setState((s) => ({ ...s, running: false }));
    };

    return () => {
      es.close();
    };
  }, [biomeName]);

  async function runRound() {
    setState((s) => ({ ...s, running: true, roundComplete: false }));
    try {
      await api.quorum.runRound(biomeName);
    } catch (err) {
      console.error("runRound error:", err);
      setState((s) => ({ ...s, running: false }));
    }
  }

  return { ...state, runRound };
}
