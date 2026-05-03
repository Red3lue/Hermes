import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { resolveAgent, type AgentRecords } from "hermes-agents-sdk";
import { useAgentInbox } from "@/hooks/useAgentInbox";
import { useWallet } from "@/hooks/useWallet";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { AgentAvatar } from "@/components/AgentAvatar";
import { OnChainPanel } from "@/components/OnChainPanel";
import { HermesShell } from "@/components/HermesShell";
import { AnimaPanel } from "@/components/AnimaPanel";
import { publicClient } from "@/lib/chainConfig";

export default function AgentDetail() {
  const { ens: rawEns } = useParams<{ ens: string }>();
  const ens = rawEns ? decodeURIComponent(rawEns) : "";
  const slug = ens.split(".")[0];
  const { messages, loading: inboxLoading } = useAgentInbox(ens || undefined);
  const { walletClient } = useWallet();
  const knownAgents = useKnownAgents();
  const [records, setRecords] = useState<AgentRecords | null>(null);
  const [resolveError, setResolveError] = useState<string | null>(null);
  const [composeText, setComposeText] = useState("");
  const [sending, setSending] = useState(false);
  const [sendResult, setSendResult] = useState<string | null>(null);
  const [showPersona, setShowPersona] = useState(false);

  const known = Object.values(knownAgents).find((ka) => ka.ens === ens);

  useEffect(() => {
    if (!ens) return;
    resolveAgent(ens, publicClient)
      .then(setRecords)
      .catch((e: Error) => setResolveError(e.message));
  }, [ens]);

  async function sendMessage() {
    if (!composeText.trim() || !walletClient || !records) return;
    setSending(true);
    setSendResult(null);
    try {
      // For now, just show the tx would go here - full send requires SDK wiring
      // TODO: wire up full send flow with browserStorage upload + inbox append
      setSendResult("Message sending requires wallet + 0G upload. Coming soon.");
    } catch (err) {
      setSendResult(`Error: ${(err as Error).message}`);
    } finally {
      setSending(false);
    }
  }

  const rightSlot = known ? (
    <button
      onClick={() => setShowPersona((v) => !v)}
      className={`hidden sm:inline-flex text-[11px] font-mono uppercase tracking-widest border rounded px-2.5 py-1 transition-all ${
        showPersona
          ? "border-flux-500 text-flux-200 shadow-neon-flux"
          : "border-hermes-700/40 text-gray-400 hover:text-hermes-200 hover:border-hermes-500/60"
      }`}
    >
      persona
    </button>
  ) : null;

  return (
    <HermesShell
      full
      compact
      crumbs={[
        { label: "dashboard", to: "/dashboard" },
        { label: ens },
      ]}
      rightSlot={rightSlot}
    >
      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col min-w-0">
          {/* Agent header */}
          <div className="flex-shrink-0 border-b border-hermes-700/20 px-4 py-5 bg-ink-900/30">
            <div className="flex items-center gap-4">
              <AgentAvatar slug={slug} size={56} />
              <div>
                <p className="font-display text-xl font-bold text-gray-100">
                  {known?.displayName ?? slug}
                </p>
                <p className="text-sm font-mono text-hermes-300">{ens}</p>
                {known?.tagline && (
                  <p className="text-sm text-gray-400 mt-0.5">
                    {known.tagline}
                  </p>
                )}
              </div>
            </div>
            {resolveError && (
              <p className="mt-2 text-xs text-red-400">
                ENS resolve: {resolveError}
              </p>
            )}
            {records && (
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div className="panel-soft p-3">
                  <p className="eyebrow mb-1">addr</p>
                  <p className="font-mono text-gray-300 break-all">
                    {records.addr}
                  </p>
                </div>
                <div className="panel-soft p-3">
                  <p className="eyebrow mb-1">pubkey</p>
                  <p className="font-mono text-gray-300 truncate">
                    {records.pubkey.slice(0, 30)}…
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Anima panel */}
          <div className="flex-shrink-0 px-4 py-4 border-b border-hermes-700/20">
            {ens && <AnimaPanel ens={ens} />}
          </div>

          {/* Inbox events */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <p className="eyebrow mb-3">Inbox events · {messages.length}</p>
            {inboxLoading && (
              <p className="text-xs font-mono text-gray-500">Loading…</p>
            )}
            <div className="space-y-2">
              {messages.map((m) => (
                <div
                  key={m.transactionHash}
                  className="panel-soft p-3 text-xs"
                >
                  <div className="flex justify-between">
                    <span className="font-mono text-gray-500">
                      block {m.blockNumber.toString()}
                    </span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${m.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-hermes-300 hover:text-hermes-200"
                    >
                      {m.transactionHash.slice(0, 12)}…
                    </a>
                  </div>
                  <p className="mt-1 font-mono text-gray-500 truncate">
                    root · {m.rootHash}
                  </p>
                  <p className="font-mono text-gray-600 truncate">
                    from · {m.from}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {/* Send message composer */}
          <div className="flex-shrink-0 border-t border-hermes-700/20 px-4 py-4 bg-ink-900/40 backdrop-blur-sm">
            <p className="eyebrow mb-2">Send encrypted message</p>
            <div className="flex gap-3 items-end">
              <textarea
                className="flex-1 rounded-lg border border-hermes-700/40 bg-ink-900/80 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:border-hermes-400 focus:shadow-neon-cyan focus:outline-none transition-all"
                rows={2}
                placeholder="Type a message… (Enter to send)"
                value={composeText}
                onChange={(e) => setComposeText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendMessage();
                  }
                }}
                disabled={sending}
              />
              <button
                className="btn-neon"
                onClick={sendMessage}
                disabled={sending || !composeText.trim() || !walletClient}
              >
                {sending ? "…" : "Send →"}
              </button>
            </div>
            {sendResult && (
              <p className="mt-2 text-xs text-gray-500">{sendResult}</p>
            )}
            <p className="mt-1 text-[11px] font-mono text-gray-600">
              body sealed before leaving browser ·{" "}
              {!walletClient && "connect wallet to send"}
            </p>
          </div>
        </main>

        {/* Persona side panel */}
        {showPersona && known && (
          <aside className="w-72 flex-shrink-0 border-l border-flux-700/20 overflow-y-auto p-4 bg-ink-900/40">
            <p className="eyebrow text-flux-300 mb-4">Persona</p>
            <p className="text-sm text-gray-200">{known.tagline}</p>
            <p className="mt-2 text-xs text-gray-500 font-mono">{known.ens}</p>
          </aside>
        )}

        {/* On-chain panel (sidebar on xl) */}
        <aside className="hidden xl:flex w-72 flex-shrink-0 border-l border-hermes-700/20 overflow-y-auto p-4 flex-col gap-4 bg-ink-900/40">
          <p className="eyebrow">
            On-chain events · {messages.length}
          </p>
          <OnChainPanel messages={messages} />
        </aside>
      </div>
    </HermesShell>
  );
}
