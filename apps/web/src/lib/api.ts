const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

export type AgentInfo = {
  slug: string;
  ens: string;
  address: string;
  roles: string[];
  x25519PubKey: string;
  persona?: string;
};

export type TranscriptEntry = {
  id: string;
  slug: string;
  ens: string;
  text: string;
  ts: number;
  rootHash?: string;
  verdict?: string;
};

export type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  rootHash?: string;
  txHash?: string;
  isEncrypted?: boolean;
};

export type ContextState = {
  context: string;
  version: number;
  rootHash: string;
};

export type BiomeMember = { ens: string; pubkey: string };

export type BiomeDoc = {
  v: 1;
  name: string;
  goal: string;
  rules: Record<string, unknown>;
  members: BiomeMember[];
  ownerEns: string;
  version: number;
  createdAt: number;
  sig: string;
};

export type BiomeResolveResult = {
  root: string;
  version: number;
  doc: BiomeDoc;
};

async function get<T>(path: string): Promise<T> {
  const r = await fetch(`${BASE}${path}`);
  if (!r.ok) throw new Error(`GET ${path} → ${r.status}`);
  return r.json() as Promise<T>;
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({ error: r.statusText }));
    throw new Error((err as { error: string }).error ?? r.statusText);
  }
  return r.json() as Promise<T>;
}

export const api = {
  agents: {
    list: () => get<AgentInfo[]>("/agents"),
    get: (slug: string) => get<AgentInfo>(`/agents/${slug}`),
  },
  quorum: {
    runRound: (biomeName: string) =>
      post<{ ok: boolean; message: string }>(`/quorum/${encodeURIComponent(biomeName)}/run`, {}),
    streamUrl: (biomeName: string) =>
      `${BASE}/quorum/${encodeURIComponent(biomeName)}/stream`,
  },
  context: {
    get: (biomeName: string) =>
      get<ContextState>(`/biome/${encodeURIComponent(biomeName)}/context`),
    set: (biomeName: string, context: string) =>
      post<{ ok: boolean; version: number; rootHash: string }>(
        `/biome/${encodeURIComponent(biomeName)}/context`,
        { context },
      ),
    resolve: (biomeName: string) =>
      get<BiomeResolveResult>(`/biome/${encodeURIComponent(biomeName)}/resolve`),
  },
  chatbot: {
    sendMessage: (slug: string, text: string, sessionId: string) =>
      post<{ userMessage: ChatMessage; agentMessage: ChatMessage }>(
        `/chatbot/${slug}/message`,
        { text, sessionId },
      ),
    getLog: (slug: string, sessionId: string) =>
      get<ChatMessage[]>(`/chatbot/${slug}/log?session=${sessionId}`),
  },
};
