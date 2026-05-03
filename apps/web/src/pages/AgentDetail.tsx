import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { resolveAgent, type AgentRecords } from "hermes-agents-sdk";
import { useAgentInbox } from "@/hooks/useAgentInbox";
import { useWallet } from "@/hooks/useWallet";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { AgentAvatar } from "@/components/AgentAvatar";
import { OnChainPanel } from "@/components/OnChainPanel";
import { WalletButton } from "@/components/WalletButton";
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

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <nav className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link to="/dashboard" className="text-gray-400 text-sm hover:text-gray-200">
          dashboard
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-mono truncate">{ens}</span>
        <div className="ml-auto flex items-center gap-2">
          {known && (
            <button
              onClick={() => setShowPersona((v) => !v)}
              className={`text-xs border rounded px-2 py-1 transition-colors ${
                showPersona
                  ? "border-hermes-600 text-hermes-300"
                  : "border-gray-700 text-gray-500 hover:text-gray-300"
              }`}
            >
              persona
            </button>
          )}
          <WalletButton />
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        <main className="flex flex-1 flex-col min-w-0">
          {/* Agent header */}
          <div className="flex-shrink-0 border-b border-gray-800 px-4 py-4">
            <div className="flex items-center gap-4">
              <AgentAvatar slug={slug} size={48} />
              <div>
                <p className="font-bold text-lg">{known?.displayName ?? slug}</p>
                <p className="text-sm font-mono text-gray-500">{ens}</p>
                {known?.tagline && (
                  <p className="text-sm text-gray-400 mt-0.5">{known.tagline}</p>
                )}
              </div>
            </div>
            {resolveError && (
              <p className="mt-2 text-xs text-red-400">ENS resolve: {resolveError}</p>
            )}
            {records && (
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <div>
                  <p className="text-gray-600 mb-0.5">addr</p>
                  <p className="font-mono text-gray-400">{records.addr}</p>
                </div>
                <div>
                  <p className="text-gray-600 mb-0.5">pubkey</p>
                  <p className="font-mono text-gray-400 truncate">{records.pubkey.slice(0, 30)}…</p>
                </div>
              </div>
            )}
          </div>

          {/* Anima panel */}
          <div className="flex-shrink-0 px-4 py-4 border-b border-gray-800">
            {ens && <AnimaPanel ens={ens} />}
          </div>

          {/* Inbox events */}
          <div className="flex-1 overflow-y-auto px-4 py-4">
            <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Inbox Events ({messages.length})
            </h3>
            {inboxLoading && <p className="text-xs text-gray-600">Loading…</p>}
            <div className="space-y-2">
              {messages.map((m) => (
                <div key={m.transactionHash} className="rounded border border-gray-800 bg-gray-900 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="font-mono text-gray-600">block {m.blockNumber.toString()}</span>
                    <a
                      href={`https://sepolia.etherscan.io/tx/${m.transactionHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-mono text-hermes-400 hover:text-hermes-300"
                    >
                      {m.transactionHash.slice(0, 12)}…
                    </a>
                  </div>
                  <p className="mt-1 font-mono text-gray-700 truncate">root: {m.rootHash}</p>
                  <p className="font-mono text-gray-700 truncate">from: {m.from}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Send message composer */}
          <div className="flex-shrink-0 border-t border-gray-800 px-4 py-3">
            <p className="text-xs font-mono font-semibold text-gray-500 mb-2">
              Send encrypted message
            </p>
            <div className="flex gap-3 items-end">
              <textarea
                className="flex-1 rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:border-hermes-600 focus:outline-none"
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
                className="rounded-xl bg-hermes-600 px-4 py-3 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50"
                onClick={sendMessage}
                disabled={sending || !composeText.trim() || !walletClient}
              >
                {sending ? "…" : "Send"}
              </button>
            </div>
            {sendResult && <p className="mt-2 text-xs text-gray-500">{sendResult}</p>}
            <p className="mt-1 text-xs text-gray-700">
              body sealed before leaving browser ·{" "}
              {!walletClient && "connect wallet to send"}
            </p>
          </div>
        </main>

        {/* Persona side panel */}
        {showPersona && known && (
          <aside className="w-72 flex-shrink-0 border-l border-gray-800 overflow-y-auto p-4">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Persona
            </h2>
            <p className="text-sm text-gray-300">{known.tagline}</p>
            <p className="mt-2 text-xs text-gray-600 font-mono">{known.ens}</p>
          </aside>
        )}

        {/* On-chain panel (sidebar on xl) */}
        <aside className="hidden xl:flex w-72 flex-shrink-0 border-l border-gray-800 overflow-y-auto p-4 flex-col gap-4">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
            On-chain events ({messages.length})
          </h2>
          <OnChainPanel messages={messages} />
        </aside>
      </div>
    </div>
  );
}
