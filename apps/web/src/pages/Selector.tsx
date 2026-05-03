import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { useSelectorInbox } from "@/hooks/useSelectorInbox";
import { submitToSelector } from "@/lib/selectorClient";
import { deriveX25519FromWallet } from "@/lib/userIdentity";

const SELECTOR_ENS =
  import.meta.env.VITE_SELECTOR_ENS ?? "selector.hermes.eth";

// The three experts the Selector knows about. Mirrors the Selector's
// Anima — keep in sync if you add an expert. Used purely for the
// "experts roster" sidebar card; the actual routing decision happens
// server-side based on the Selector's published Anima.
const EXPERTS = [
  {
    ens: "tech.experts.hermes.eth",
    label: "Tech",
    domain: "Bugs, APIs, integration, protocol, debugging.",
  },
  {
    ens: "legal.experts.hermes.eth",
    label: "Legal",
    domain: "ToS, privacy, contracts, IP, regulation, GDPR/CCPA.",
  },
  {
    ens: "product.experts.hermes.eth",
    label: "Product",
    domain: "Features, UX, pricing, comparisons, recommendations.",
  },
];

type RequestRow = {
  requestId: string;
  markdown: string;
  submittedAt: number;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

export default function SelectorPage() {
  const { address, walletClient } = useWallet();
  const user = useUserAgent();
  const knownAgents = useKnownAgents();

  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [pubkey, setPubkey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (user.status !== "ready" || !walletClient || !address) {
      setSecretKey(null);
      setPubkey(null);
      return;
    }
    let cancelled = false;
    deriveX25519FromWallet(walletClient, address)
      .then((kp) => {
        if (cancelled) return;
        setSecretKey(kp.secretKey);
        setPubkey(kp.pubkey);
      })
      .catch((e: Error) => !cancelled && setKeyError(e.message));
    return () => {
      cancelled = true;
    };
  }, [user.status, walletClient, address]);

  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  const inbox = useSelectorInbox({
    userEns: user.identity?.ens ?? null,
    userSecretKey: secretKey,
    selectorEns: SELECTOR_ENS,
  });

  const activeRequest =
    requests.find((r) => r.requestId === activeRequestId) ??
    requests[requests.length - 1] ??
    null;
  const activeResponse = activeRequest
    ? inbox.responses.get(activeRequest.requestId)
    : undefined;

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [activeResponse]);

  async function submit() {
    if (!draft.trim()) return;
    if (
      !walletClient ||
      !address ||
      !user.identity?.ens ||
      !secretKey ||
      !pubkey
    ) {
      setSubmitError("connect wallet + complete user setup first");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await submitToSelector({
        selectorEns: SELECTOR_ENS,
        userEns: user.identity.ens,
        userPubkey: pubkey,
        userSecretKey: secretKey,
        markdown: draft.trim(),
        walletClient,
      });
      const row: RequestRow = {
        requestId: r.requestId,
        markdown: draft.trim(),
        submittedAt: Date.now(),
        txHash: r.tx,
        rootHash: r.rootHash,
      };
      setRequests((prev) => [...prev, row]);
      setActiveRequestId(r.requestId);
      setDraft("");
    } catch (err) {
      setSubmitError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const selectorMeta = Object.values(knownAgents).find(
    (a) => a.ens === SELECTOR_ENS,
  );

  // Progress: 0 = nothing yet, 1 = sent, 2 = routed (we don't see this from
  // the FE — the routing is internal — so we show 1 → 3), 3 = answered.
  const progressStep: 0 | 1 | 3 = useMemo(() => {
    if (!activeRequest) return 0;
    if (activeResponse) return 3;
    return 1;
  }, [activeRequest, activeResponse]);

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <nav className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link to="/demos" className="text-gray-400 text-sm hover:text-gray-200">
          demos
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-semibold">selector</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-mono text-gray-600 hidden sm:block">
            via {SELECTOR_ENS}
          </span>
          {user.identity?.ens && (
            <span className="text-xs font-mono text-emerald-400 hidden md:block">
              you: {user.identity.ens}
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {address && user.status !== "ready" && <UserSetupBanner user={user} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Selector + Experts roster */}
        <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Selector
            </h2>
            <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3 flex items-center gap-3">
              <AgentAvatar slug="selector" size={32} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-hermes-200 truncate">
                  {selectorMeta?.displayName ?? "Selector"}
                </p>
                <p className="text-xs font-mono text-gray-400 truncate">
                  {SELECTOR_ENS}
                </p>
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  Reads its Anima as a routing manifest, picks the right
                  expert, forwards your request, returns their answer.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-gray-800">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Experts ({EXPERTS.length})
            </h2>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              Each expert has its own ENS, its own X25519 keypair, and its
              own encrypted Anima describing its domain expertise + voice.
              You can DM any of them directly for follow-up.
            </p>
            {EXPERTS.map((e) => (
              <div
                key={e.ens}
                className="rounded-lg border border-gray-800 bg-gray-900 p-3 mb-2"
              >
                <p className="text-sm text-gray-200 font-semibold">
                  {e.label}
                </p>
                <p className="text-xs font-mono text-gray-500 truncate">
                  {e.ens}
                </p>
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  {e.domain}
                </p>
              </div>
            ))}
          </div>

          <div className="p-4 text-xs text-gray-500 leading-relaxed">
            <p className="mb-2 text-gray-300 font-semibold">How this works</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>
                Your question is sealed for{" "}
                <code className="text-hermes-400">{SELECTOR_ENS}</code>'s
                pubkey and posted on chain.
              </li>
              <li>
                The Selector decrypts, reads its Anima (a routing manifest
                describing each expert's domain), and picks one.
              </li>
              <li>
                It forwards your question as a sealed DM to that expert,
                who answers from their own Anima.
              </li>
              <li>
                The Selector wraps the expert's answer with{" "}
                <em>"routed to X because Y"</em> and returns it to your
                inbox.
              </li>
            </ol>
          </div>
        </aside>

        {/* Center: composer + transcript */}
        <main className="flex flex-1 flex-col min-w-0">
          {!activeRequest && (
            <div className="flex-shrink-0 border-b border-gray-800 bg-gradient-to-br from-hermes-950/40 via-gray-950 to-gray-950 px-6 py-8">
              <div className="max-w-3xl mx-auto">
                <span className="inline-block text-[10px] font-mono uppercase tracking-widest text-hermes-400 border border-hermes-700/60 bg-hermes-950/40 rounded-full px-2.5 py-0.5 mb-3">
                  Anima as routing manifest
                </span>
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-100 leading-tight">
                  Ask the Selector.
                  <br />
                  <span className="text-hermes-400">It picks the right expert.</span>
                </h1>
                <p className="mt-4 text-gray-400 leading-relaxed max-w-2xl">
                  The Selector is an ENS-named agent whose <strong className="text-gray-200">Anima</strong>{" "}
                  is a routing manifest. It reads its own soul to decide
                  which expert to forward your question to — and returns
                  their answer with full attribution. Edit the Anima
                  (in the Dashboard, only the agent's owner can), and
                  routing behaviour changes at runtime, on chain.
                </p>
              </div>
            </div>
          )}

          {/* Composer */}
          <div className="flex-shrink-0 border-b border-gray-800 p-4 sm:p-6">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-200">
                  Ask the Selector
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-widest rounded px-2 py-0.5 border border-emerald-700 text-emerald-400">
                  public · sealed DM
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Anyone with a{" "}
                <code className="text-hermes-400">*.users.hermes.eth</code>{" "}
                subdomain can ask. Try a tech bug, a privacy question, or a
                pricing comparison — the Selector will route accordingly.
              </p>
              <textarea
                className="w-full rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50 transition-colors"
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. My API integration returns 401 on every refresh — what's the most likely cause?"
                disabled={user.status !== "ready"}
              />
              <div className="flex items-center gap-3 mt-3 flex-wrap">
                <button
                  className="rounded-md bg-hermes-600 px-4 py-2 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors flex items-center gap-2"
                  onClick={submit}
                  disabled={
                    submitting || !draft.trim() || user.status !== "ready"
                  }
                >
                  {submitting ? (
                    <>
                      <span className="animate-pulse">●</span> Sealing &
                      sending…
                    </>
                  ) : (
                    "Seal & send to Selector"
                  )}
                </button>
                <span className="text-[11px] font-mono text-gray-600">
                  1 wallet sig · 1 0G upload · 1 Sepolia tx
                </span>
                {submitError && (
                  <span className="text-xs text-red-400">{submitError}</span>
                )}
              </div>
              {keyError && (
                <p className="mt-2 text-xs text-red-400">
                  key derivation: {keyError}
                </p>
              )}
              {inbox.error && (
                <p className="mt-2 text-xs text-red-400">
                  inbox poll: {inbox.error}
                </p>
              )}
            </div>
          </div>

          {/* Active request + response */}
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6"
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {activeRequest && (
                <>
                  {/* Question card */}
                  <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-4">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-mono uppercase tracking-widest text-hermes-300">
                        Your question
                      </p>
                      <span className="text-xs font-mono text-gray-600">
                        #{activeRequest.requestId.slice(0, 8)}
                      </span>
                    </div>
                    <p className="text-sm text-gray-100 whitespace-pre-wrap leading-relaxed">
                      {activeRequest.markdown}
                    </p>
                    <div className="mt-3 pt-3 border-t border-hermes-900/50 flex flex-wrap gap-3 text-[11px] font-mono text-gray-600">
                      <a
                        href={`https://sepolia.etherscan.io/tx/${activeRequest.txHash}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-hermes-400 hover:text-hermes-300"
                      >
                        request tx ↗ {activeRequest.txHash.slice(0, 12)}…
                      </a>
                      <span>0G root: {activeRequest.rootHash.slice(0, 14)}…</span>
                      <span>
                        sent {new Date(activeRequest.submittedAt).toLocaleTimeString()}
                      </span>
                    </div>
                  </div>

                  {/* Working spinner */}
                  {progressStep === 1 && (
                    <div className="rounded-md border border-yellow-900/50 bg-yellow-950/20 p-3 text-sm text-yellow-300/80 flex items-center gap-3">
                      <span className="animate-pulse">●</span>
                      <span>
                        Selector is decrypting and choosing the right expert…
                      </span>
                    </div>
                  )}

                  {/* Final response with routing pill */}
                  {activeResponse && (
                    <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-5">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h4 className="text-xs font-mono font-semibold uppercase tracking-widest text-emerald-300">
                          Selector → you
                        </h4>
                        <span className="text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border border-emerald-700 bg-emerald-500/15 text-emerald-300">
                          routed to {activeResponse.expertEns.split(".")[0]}
                        </span>
                      </div>
                      <pre className="whitespace-pre-wrap text-sm text-gray-100 font-sans leading-relaxed">
                        {activeResponse.markdown}
                      </pre>
                      <div className="mt-4 pt-3 border-t border-emerald-900 flex flex-wrap gap-3 text-[11px] font-mono text-gray-600">
                        <a
                          href={`https://sepolia.etherscan.io/tx/${activeResponse.txHash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-hermes-400 hover:text-hermes-300"
                        >
                          response tx ↗ {activeResponse.txHash.slice(0, 12)}…
                        </a>
                        <span>0G root: {activeResponse.rootHash.slice(0, 14)}…</span>
                        <span>expert: {activeResponse.expertEns}</span>
                        <span>
                          received{" "}
                          {new Date(activeResponse.ts).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

function UserSetupBanner({ user }: { user: ReturnType<typeof useUserAgent> }) {
  const labels: Record<string, string> = {
    "needs-sign": "Sign to derive your X25519 keypair",
    "needs-register": "Register your <label>.users.hermes.eth subname",
    "needs-records": "Set your ENS records (addr / pubkey / inbox)",
  };
  const actions: Record<string, () => void> = {
    "needs-sign": user.sign,
    "needs-register": user.register,
    "needs-records": user.setRecords,
  };
  const label = labels[user.status];
  if (!label) return null;
  return (
    <div className="flex-shrink-0 px-4 py-2 border-b border-yellow-900 bg-yellow-950/20 text-sm flex items-center gap-3">
      <span className="text-yellow-400">⚠</span>
      <span className="text-gray-300 flex-1">{label}</span>
      {user.error && <span className="text-xs text-red-400">{user.error}</span>}
      <button
        onClick={actions[user.status]}
        disabled={user.busy}
        className="rounded-md bg-hermes-600 px-3 py-1 text-xs font-semibold hover:bg-hermes-500 disabled:opacity-50"
      >
        {user.busy ? "…" : "continue"}
      </button>
    </div>
  );
}
