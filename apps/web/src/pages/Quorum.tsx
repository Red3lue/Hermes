import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useQuorumOnChain } from "@/hooks/useQuorumOnChain";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { submitContext, submitContextViaProxy } from "@/lib/quorumClient";
import { deriveX25519FromWallet } from "@/lib/userIdentity";

const BIOME_NAME =
  import.meta.env.VITE_QUORUM_BIOME ?? "quorum.biomes.hermes.eth";

const VERDICT_COLORS: Record<string, string> = {
  agree: "text-emerald-400",
  disagree: "text-red-400",
  abstain: "text-yellow-400",
};

type StageRow = {
  ts: number;
  label: string;
  detail?: string;
  verdict?: string;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

function formatStage(
  stage: string,
  meta: Record<string, unknown>,
): StageRow["label"] {
  switch (stage) {
    case "started":
      return "Coordinator picked up context";
    case "member-replied":
      return `${(meta.slug as string) ?? "member"} replied`;
    case "tally":
      return `Tally complete (${JSON.stringify(meta.counts ?? {})})`;
    case "report-posted":
      return "Report posted";
    default:
      return stage;
  }
}

export default function QuorumPage() {
  const { address, walletClient } = useWallet();
  const user = useUserAgent();
  const knownAgents = useKnownAgents();

  // Re-derive secret key in memory each session (not persisted).
  // Triggered when user is "ready" so we can decrypt biome blobs.
  const [secretKey, setSecretKey] = useState<string | null>(null);
  const [keyError, setKeyError] = useState<string | null>(null);

  useEffect(() => {
    if (user.status !== "ready" || !walletClient || !address) {
      setSecretKey(null);
      return;
    }
    let cancelled = false;
    deriveX25519FromWallet(walletClient, address)
      .then((kp) => {
        if (!cancelled) setSecretKey(kp.secretKey);
      })
      .catch((e: Error) => !cancelled && setKeyError(e.message));
    return () => {
      cancelled = true;
    };
  }, [user.status, walletClient, address]);

  // Quorum on-chain stream
  const onchain = useQuorumOnChain({
    biomeName: BIOME_NAME,
    userEns: user.identity?.ens ?? null,
    userSecretKey: secretKey,
  });

  // Compose timeline for the most recent contextId
  const activeContextId = onchain.contextEvents.at(-1)?.contextId ?? null;
  const activeContext = onchain.contextEvents.find(
    (c) => c.contextId === activeContextId,
  );
  const activeStages = onchain.stageEvents.filter(
    (s) => s.contextId === activeContextId,
  );
  const activeReport = onchain.reportEvents.find(
    (r) => r.contextId === activeContextId,
  );

  const timeline: StageRow[] = useMemo(() => {
    if (!activeContext) return [];
    const rows: StageRow[] = [
      {
        ts: activeContext.ts,
        label: "Context submitted",
        detail: activeContext.from,
        txHash: activeContext.txHash,
        rootHash: activeContext.rootHash,
      },
    ];
    for (const s of activeStages) {
      rows.push({
        ts: s.ts,
        label: formatStage(s.stage, s.meta),
        verdict: (s.meta as { verdict?: string }).verdict,
        txHash: s.txHash,
        rootHash: s.rootHash,
      });
    }
    if (activeReport) {
      rows.push({
        ts: activeReport.ts,
        label: "Report posted",
        detail: `tally: ${Object.entries(activeReport.tally)
          .map(([k, v]) => `${v} ${k}`)
          .join(", ")}`,
        txHash: activeReport.txHash,
        rootHash: activeReport.rootHash,
      });
    }
    return rows;
  }, [activeContext, activeStages, activeReport]);

  // Submit context
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [timeline.length, activeReport]);

  async function submit() {
    if (!draft.trim()) return;
    if (!walletClient || !address || !user.identity?.ens || !secretKey) {
      setSubmitError("connect wallet + complete user setup first");
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const r = await submitContext({
        biomeName: BIOME_NAME,
        ownerEns: user.identity.ens,
        ownerSecretKey: secretKey,
        markdown: draft.trim(),
        walletClient,
      });
      console.log("submitted context", r);
      setDraft("");
    } catch (err) {
      const msg = (err as Error).message;
      // If the failure is "no wrap / not a member", try the proxy upload
      // fallback which uploads plaintext to 0G then appends it on-chain.
      if (msg.includes("no wrap") || msg.includes("not a member")) {
        try {
          const r = await submitContextViaProxy({
            biomeName: BIOME_NAME,
            markdown: draft.trim(),
            walletClient: walletClient as any,
          });
          console.log("proxy-submitted context", r);
          setDraft("");
        } catch (err2) {
          setSubmitError((err2 as Error).message);
        }
      } else {
        setSubmitError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  }

  // Members for the left sidebar (read from BiomeDoc once it's loaded)
  const members = onchain.doc?.members ?? [];

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
        <span className="text-gray-300 text-sm font-semibold">quorum</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-mono text-gray-600 hidden sm:block">
            {BIOME_NAME}
          </span>
          {user.identity?.ens && (
            <span className="text-xs font-mono text-emerald-400 hidden md:block">
              you: {user.identity.ens}
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {/* User setup banner */}
      {address && user.status !== "ready" && <UserSetupBanner user={user} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: members */}
        <aside className="hidden lg:flex w-64 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto p-4 gap-3">
          <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
            Members ({members.length})
          </h2>
          {members.map((m) => {
            const slug = m.ens.split(".")[0];
            const known = Object.values(knownAgents).find(
              (ka) => ka.ens === m.ens,
            );
            return (
              <div
                key={m.ens}
                className="rounded-lg border border-gray-800 bg-gray-900 p-2 flex items-center gap-2"
              >
                <AgentAvatar slug={slug} size={24} />
                <div className="min-w-0">
                  <p className="text-xs font-mono text-gray-300 truncate">
                    {m.ens}
                  </p>
                  {known?.displayName && (
                    <p className="text-xs text-gray-600">{known.displayName}</p>
                  )}
                </div>
              </div>
            );
          })}
          {onchain.error && (
            <p className="text-xs text-red-400">{onchain.error}</p>
          )}
        </aside>

        {/* Center: context + timeline + report */}
        <main className="flex flex-1 flex-col min-w-0 border-r border-gray-800">
          {/* Context submit panel */}
          <div className="flex-shrink-0 border-b border-gray-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
                Submit Context
              </h3>
              <span className="text-xs rounded px-1.5 py-0.5 border border-emerald-700 text-emerald-400">
                public
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Any connected, configured member can submit context to this
              quorum.
            </p>
            <textarea
              className="w-full rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50"
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Paste a proposal or question for the agents to deliberate on…"
              disabled={user.status !== "ready"}
            />
            <div className="flex items-center gap-3 mt-3">
              <button
                className="rounded-md bg-hermes-600 px-4 py-1.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
                onClick={submit}
                disabled={
                  submitting || !draft.trim() || user.status !== "ready"
                }
              >
                {submitting ? "Signing & uploading…" : "Sign & submit on-chain"}
              </button>
              {submitError && (
                <span className="text-xs text-red-400">{submitError}</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-700">
              1 wallet sig + 1 0G upload + 1 Sepolia tx · the coordinator agent
              detects this within ~5s
            </p>
            {keyError && (
              <p className="mt-1 text-xs text-red-400">
                key derivation: {keyError}
              </p>
            )}
          </div>

          {/* Stage timeline */}
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 space-y-3"
          >
            {timeline.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3 py-12">
                <p className="text-2xl">🗳️</p>
                <p className="text-sm max-w-md">
                  No active round. A quorum member submits a context envelope on
                  chain → the coordinator picks it up → members deliberate → the
                  reporter posts the synthesis here.
                </p>
                {onchain.loading && (
                  <p className="text-xs text-gray-700">polling biome inbox…</p>
                )}
              </div>
            )}
            {timeline.length > 0 && activeContext && (
              <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3">
                <p className="text-xs font-mono text-hermes-300 mb-1">
                  Question (from {activeContext.from})
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {activeContext.markdown}
                </p>
              </div>
            )}
            {timeline.slice(1).map((row, i) => (
              <div
                key={`${row.txHash}-${i}`}
                className="rounded-md border border-gray-800 bg-gray-900 p-2 flex items-start gap-3 text-sm"
              >
                <span className="text-emerald-400 mt-0.5">✓</span>
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200">
                    {row.label}
                    {row.verdict && (
                      <span
                        className={`ml-2 font-mono text-xs ${VERDICT_COLORS[row.verdict] ?? "text-gray-400"}`}
                      >
                        [{row.verdict}]
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-gray-600 font-mono">
                    {new Date(row.ts).toLocaleTimeString()}
                    {row.detail && ` · ${row.detail}`}
                  </p>
                </div>
                <a
                  href={`https://sepolia.etherscan.io/tx/${row.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs font-mono text-hermes-400 hover:text-hermes-300 flex-shrink-0"
                >
                  {row.txHash.slice(0, 10)}…
                </a>
              </div>
            ))}
            {/* Report panel */}
            {activeReport && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-4 mt-4">
                <h4 className="text-xs font-mono font-semibold uppercase tracking-widest text-emerald-300 mb-3">
                  Final Report
                </h4>
                <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed">
                  {activeReport.markdown}
                </pre>
                <div className="mt-3 pt-3 border-t border-emerald-900 flex gap-3 text-xs font-mono text-gray-600">
                  <a
                    href={`https://sepolia.etherscan.io/tx/${activeReport.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hermes-400 hover:text-hermes-300"
                  >
                    tx: {activeReport.txHash.slice(0, 12)}…
                  </a>
                  <span>root: {activeReport.rootHash.slice(0, 14)}…</span>
                </div>
              </div>
            )}
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
