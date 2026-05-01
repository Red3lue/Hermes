import type { Response } from "express";

export type TranscriptEntry = {
  id: string;
  slug: string;
  ens: string;
  text: string;
  ts: number;
  rootHash?: string;
  verdict?: string; // "agree" | "disagree" | "abstain"
};

type Store = {
  context: string;
  contextVersion: number;
  contextRootHash: string;
  transcript: TranscriptEntry[];
  running: boolean;
  sseClients: Response[];
};

const stores = new Map<string, Store>();

export function getStore(biomeName: string): Store {
  if (!stores.has(biomeName)) {
    stores.set(biomeName, {
      context: "",
      contextVersion: 0,
      contextRootHash: "",
      transcript: [],
      running: false,
      sseClients: [],
    });
  }
  return stores.get(biomeName)!;
}

export function pushEntry(biomeName: string, entry: TranscriptEntry) {
  const store = getStore(biomeName);
  store.transcript.push(entry);
  broadcastSSE(biomeName, { type: "entry", data: entry });
}

export function broadcastSSE(biomeName: string, payload: unknown) {
  const store = getStore(biomeName);
  const data = `data: ${JSON.stringify(payload)}\n\n`;
  for (const res of store.sseClients) {
    try {
      res.write(data);
    } catch {
      // client disconnected
    }
  }
}

export function addSSEClient(biomeName: string, res: Response) {
  getStore(biomeName).sseClients.push(res);
}

export function removeSSEClient(biomeName: string, res: Response) {
  const store = getStore(biomeName);
  store.sseClients = store.sseClients.filter((c) => c !== res);
}
