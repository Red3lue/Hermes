const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

// Server HTTP surface is intentionally minimal:
//   - GET /agents           — read-only persona/ENS metadata
//   - GET /biome/:name/resolve — read-only BiomeDoc fetcher (used by BiomeViewer)
//   - POST /register-user   — one-time ENS subname mint (in useUserAgent)
//   - GET /blob/:root, POST /blob — 0G upload/download proxy (deployer pays)
//
// All quorum + chatbot message flow runs on chain (0G + Sepolia HermesInbox).
// The browser uses hermes-agents-sdk + viem directly. There is no /quorum, /chatbot,
// or /biome/:name/context HTTP endpoint anymore.

export type AgentInfo = {
  slug: string;
  ens: string;
  address: string;
  roles: string[];
  x25519PubKey: string;
  persona?: string;
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

export const api = {
  agents: {
    list: () => get<AgentInfo[]>("/agents"),
    get: (slug: string) => get<AgentInfo>(`/agents/${slug}`),
  },
  context: {
    resolve: (biomeName: string) =>
      get<BiomeResolveResult>(
        `/biome/${encodeURIComponent(biomeName)}/resolve`,
      ),
  },
};
