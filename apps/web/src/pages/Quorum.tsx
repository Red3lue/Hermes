import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { useQuorumStream } from "@/hooks/useQuorumStream";
import { api, type AgentInfo, type ContextState } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";
import { getEnsOwner } from "@/lib/ensOwner";
import { publicClient } from "@/lib/chainConfig";

const BIOME_NAME = import.meta.env.VITE_QUORUM_BIOME ?? "quorum.biomes.hermes.eth";

function buildAuthMessage(biomeName: string, ts: number, context: string): string {
  return [
    "Hermes biome context update v1",
    `biome: ${biomeName}`,
    `ts: ${ts}`,
    "---",
    context,
  ].join("\n");
}

const VERDICT_COLORS: Record<string, string> = {
  agree: "text-emerald-400",
  disagree: "text-red-400",
  abstain: "text-yellow-400",
};

function VerdictBadge({ verdict }: { verdict?: string }) {
  if (!verdict) return null;
  return (
    <span
      className={`ml-2 font-mono text-xs font-semibold ${VERDICT_COLORS[verdict] ?? "text-gray-400"}`}
    >
      [{verdict}]
    </span>
  );
}

function PersonaModal({
  agent,
  onClose,
}: {
  agent: AgentInfo;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        className="relative max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          className="absolute right-4 top-4 text-gray-500 hover:text-gray-300"
          onClick={onClose}
        >
          ✕
        </button>
        <div className="flex items-center gap-3 mb-4">
          <AgentAvatar slug={agent.slug} size={40} />
          <div>
            <p className="font-semibold capitalize">{agent.slug}</p>
            <p className="text-xs font-mono text-gray-500">{agent.ens}</p>
          </div>
        </div>
        <pre className="whitespace-pre-wrap text-sm text-gray-300 font-sans leading-relaxed">
          {agent.persona ?? "No persona loaded."}
        </pre>
      </div>
    </div>
  );
}

export default function QuorumPage() {
  const { entries, running, runRound } = useQuorumStream(BIOME_NAME);
  const { address, walletClient } = useWallet();
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [contextState, setContextState] = useState<ContextState | null>(null);
  const [editingContext, setEditingContext] = useState(false);
  const [draftContext, setDraftContext] = useState("");
  const [savingContext, setSavingContext] = useState(false);
  const [contextError, setContextError] = useState<string | null>(null);
  const [biomeOwner, setBiomeOwner] = useState<`0x${string}` | null>(null);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [personaAgent, setPersonaAgent] = useState<AgentInfo | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  const isOwner =
    !!address &&
    !!biomeOwner &&
    address.toLowerCase() === biomeOwner.toLowerCase();

  useEffect(() => {
    api.agents
      .list()
      .then((all) => setAgents(all.filter((a) => a.roles.includes("quorum"))));
    api.context.get(BIOME_NAME).then((c) => {
      setContextState(c);
      setDraftContext(c.context);
    });
    getEnsOwner(BIOME_NAME, publicClient)
      .then(setBiomeOwner)
      .catch((e: Error) => setOwnerError(e.message));
  }, []);

  // Auto-scroll transcript
  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [entries]);

  async function saveContext() {
    if (!draftContext.trim()) return;
    if (!walletClient || !address) {
      setContextError("Connect your wallet to upload context.");
      return;
    }
    if (!isOwner) {
      setContextError(
        `Only the ENS owner of ${BIOME_NAME} can update context.`,
      );
      return;
    }
    setSavingContext(true);
    setContextError(null);
    try {
      const trimmed = draftContext.trim();
      const ts = Date.now();
      const message = buildAuthMessage(BIOME_NAME, ts, trimmed);
      const signature = await walletClient.signMessage({
        account: address,
        message,
      });
      const result = await api.context.set(BIOME_NAME, trimmed, {
        address,
        signature,
        ts,
      });
      setContextState((prev) => ({
        context: trimmed,
        version: result.version,
        rootHash: result.rootHash ?? prev?.rootHash ?? "",
      }));
      setEditingContext(false);
    } catch (err) {
      setContextError((err as Error).message);
    } finally {
      setSavingContext(false);
    }
  }

  async function handleRunRound() {
    // Reload context state after a round so version display stays fresh
    runRound().then(() => {
      api.context.get(BIOME_NAME).then(setContextState);
    });
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
      {/* Nav */}
      <nav className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link to="/demos" className="text-gray-400 text-sm hover:text-gray-200">
          demos
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-semibold">quorum</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-mono text-gray-600 hidden sm:block">
            {BIOME_NAME}
          </span>
          {running && (
            <span className="flex items-center gap-1.5 text-xs text-hermes-300">
              <span className="h-1.5 w-1.5 rounded-full bg-hermes-400 animate-pulse" />
              round in progress
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {/* 3-column layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Roster */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto p-4 gap-4">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
            Members ({agents.length})
          </h2>
          {agents.map((agent) => (
            <div
              key={agent.slug}
              className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex flex-col gap-2"
            >
              <div className="flex items-center gap-2">
                <AgentAvatar slug={agent.slug} size={28} />
                <span className="font-semibold capitalize text-sm">
                  {agent.slug}
                </span>
              </div>
              <p className="text-xs font-mono text-gray-600 truncate">
                {agent.ens}
              </p>
              <button
                className="text-xs text-hermes-400 hover:text-hermes-300 text-left"
                onClick={async () => {
                  const full = await api.agents.get(agent.slug);
                  setPersonaAgent(full);
                }}
              >
                view persona →
              </button>
            </div>
          ))}
        </aside>

        {/* Center: Context + Transcript */}
        <main className="flex flex-1 flex-col min-w-0 border-r border-gray-800">
          {/* Context editor */}
          <div className="flex-shrink-0 border-b border-gray-800">
            <button
              className="w-full flex items-center justify-between px-4 py-3 text-sm text-gray-400 hover:text-gray-200 transition-colors"
              onClick={() => setEditingContext((v) => !v)}
            >
              <span className="font-mono font-semibold">Context</span>
              <div className="flex items-center gap-3">
                {biomeOwner && (
                  <span
                    className={`text-xs rounded px-1.5 py-0.5 border ${isOwner ? "border-emerald-700 text-emerald-400" : "border-gray-700 text-gray-500"}`}
                  >
                    {isOwner ? "owner" : "read-only"}
                  </span>
                )}
                {contextState && (
                  <span className="text-xs font-mono text-gray-600">
                    v{contextState.version}
                  </span>
                )}
                <span className="text-xs">{editingContext ? "▲" : "▼"}</span>
              </div>
            </button>
            {editingContext && (
              <div className="px-4 pb-4 flex flex-col gap-3">
                {ownerError && (
                  <p className="text-xs text-red-400">
                    Could not resolve biome owner: {ownerError}
                  </p>
                )}
                {biomeOwner && (
                  <p className="text-xs font-mono text-gray-500">
                    biome owner: <span className="text-gray-300">{biomeOwner}</span>
                    {address && (
                      <>
                        {" · "}
                        you:{" "}
                        <span
                          className={
                            isOwner ? "text-emerald-400" : "text-gray-400"
                          }
                        >
                          {address}
                        </span>
                      </>
                    )}
                  </p>
                )}
                {!isOwner && (
                  <p className="text-xs text-gray-500">
                    Only the ENS owner of <code>{BIOME_NAME}</code> can upload
                    context.{" "}
                    {address
                      ? "Your wallet does not match — switch accounts."
                      : "Connect the owner wallet to enable editing."}
                  </p>
                )}
                <textarea
                  className="w-full rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50"
                  rows={8}
                  value={draftContext}
                  onChange={(e) => setDraftContext(e.target.value)}
                  placeholder="Paste a proposal or question for the agents to deliberate on…"
                  disabled={!isOwner}
                />
                <div className="flex items-center gap-3">
                  <button
                    className="rounded-md bg-hermes-600 px-4 py-1.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
                    onClick={saveContext}
                    disabled={savingContext || !isOwner}
                  >
                    {savingContext ? "Signing…" : "Sign & upload"}
                  </button>
                  <button
                    className="rounded-md border border-gray-700 px-4 py-1.5 text-sm text-gray-400 hover:text-gray-200 transition-colors"
                    onClick={() => {
                      setDraftContext(contextState?.context ?? "");
                      setEditingContext(false);
                      setContextError(null);
                    }}
                  >
                    Cancel
                  </button>
                  {contextState?.rootHash && (
                    <button
                      className="ml-auto font-mono text-xs text-gray-600 hover:text-gray-400 transition-colors"
                      title="Click to copy root hash"
                      onClick={() =>
                        navigator.clipboard.writeText(contextState.rootHash)
                      }
                    >
                      {contextState.rootHash.slice(0, 14)}…
                    </button>
                  )}
                </div>
                {contextError && (
                  <p className="text-xs text-red-400">{contextError}</p>
                )}
              </div>
            )}
          </div>

          {/* Transcript */}
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          >
            {entries.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3">
                <p className="text-2xl">🗳️</p>
                <p className="text-sm">
                  No messages yet. Click{" "}
                  <strong className="text-gray-400">Run round</strong> to start
                  deliberation.
                </p>
              </div>
            )}
            {entries.map((entry) => (
              <div key={entry.id} className="flex gap-3">
                <AgentAvatar slug={entry.slug} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 flex-wrap">
                    <span className="font-semibold capitalize text-sm">
                      {entry.slug}
                    </span>
                    <span className="text-xs font-mono text-gray-600">
                      {entry.ens}
                    </span>
                    <VerdictBadge verdict={entry.verdict} />
                    <span className="text-xs text-gray-700 ml-auto">
                      {new Date(entry.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">
                    {entry.text}
                  </p>
                  {entry.rootHash && (
                    <p className="mt-1 text-xs font-mono text-gray-700">
                      {entry.rootHash.slice(0, 18)}…
                    </p>
                  )}
                </div>
              </div>
            ))}
            {running && (
              <div className="flex items-center gap-2 text-sm text-hermes-300">
                <span className="h-2 w-2 rounded-full bg-hermes-400 animate-pulse" />
                agents deliberating…
              </div>
            )}
          </div>

          {/* Footer: Run round */}
          <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3 flex items-center gap-4">
            <button
              className="rounded-lg bg-hermes-600 px-5 py-2 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
              onClick={handleRunRound}
              disabled={running}
            >
              {running ? "Running…" : "Run round"}
            </button>
            <p className="text-xs text-gray-600">
              Each round: {agents.length || 5} agents post one signed message,
              then a tally is computed.
            </p>
          </div>
        </main>

        {/* Right: On-chain panel */}
        <aside className="hidden xl:flex w-72 flex-shrink-0 flex-col overflow-y-auto p-4 gap-4">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
            On-chain
          </h2>
          <div className="rounded-lg border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500 space-y-2">
            <p className="font-mono text-gray-400 font-semibold">
              HermesInbox events
            </p>
            <p className="text-gray-600">
              Live events appear here once the quorum agents are registered on
              Sepolia. Run{" "}
              <code className="text-gray-500">pnpm seed-agents</code> in
              agents-server to register.
            </p>
          </div>

          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mt-2">
            Transcript ({entries.length})
          </h2>
          <div className="space-y-2">
            {entries
              .filter((e) => e.slug !== "tally")
              .slice(-6)
              .map((e) => (
                <div
                  key={e.id}
                  className="rounded border border-gray-800 bg-gray-900 p-2 flex items-center gap-2"
                >
                  <AgentAvatar slug={e.slug} size={20} />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-mono text-gray-400 capitalize truncate">
                      {e.slug}
                    </p>
                    {e.verdict && (
                      <p
                        className={`text-xs font-semibold ${VERDICT_COLORS[e.verdict] ?? ""}`}
                      >
                        {e.verdict}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>

          {/* Tally summary */}
          {entries.filter((e) => e.slug === "tally").length > 0 && (
            <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3 text-xs text-hermes-300">
              {entries.filter((e) => e.slug === "tally").at(-1)?.text}
            </div>
          )}
        </aside>
      </div>

      {personaAgent && (
        <PersonaModal
          agent={personaAgent}
          onClose={() => setPersonaAgent(null)}
        />
      )}
    </div>
  );
}
