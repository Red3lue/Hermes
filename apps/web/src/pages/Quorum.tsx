import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useQuorumOnChain } from "@/hooks/useQuorumOnChain";
import { useUserDmInbox } from "@/hooks/useUserDmInbox";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { submitRequestToCoordinator } from "@/lib/quorumClient";
import { deriveX25519FromWallet } from "@/lib/userIdentity";

const BIOME_NAME =
  import.meta.env.VITE_QUORUM_BIOME ?? "quorum.biomes.hermes.eth";
const COORDINATOR_ENS =
  import.meta.env.VITE_COORDINATOR_ENS ?? "coordinator.hermes.eth";

const VERDICT_COLORS: Record<string, string> = {
  agree: "text-emerald-400",
  disagree: "text-red-400",
  abstain: "text-yellow-400",
};
const VERDICT_BG: Record<string, string> = {
  agree: "bg-emerald-500/15 border-emerald-700",
  disagree: "bg-red-500/15 border-red-700",
  abstain: "bg-yellow-500/15 border-yellow-700",
};

type RequestRow = {
  requestId: string;
  markdown: string;
  submittedAt: number;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
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
      return "Coordinator picked up request";
    case "member-replied":
      return `${(meta.slug as string) ?? "member"} replied`;
    case "tally":
      return `Tally complete (${JSON.stringify(meta.counts ?? {})})`;
    default:
      return stage;
  }
}

export default function QuorumPage() {
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

  const userDms = useUserDmInbox({
    userEns: user.identity?.ens ?? null,
    userSecretKey: secretKey,
  });

  const onchain = useQuorumOnChain({
    biomeName: BIOME_NAME,
    userEns: user.identity?.ens ?? null,
    userSecretKey: secretKey,
  });
  const isBiomeMember = !!onchain.doc?.wraps?.[user.identity?.ens ?? ""];

  const activeRequest =
    requests.find((r) => r.requestId === activeRequestId) ??
    requests[requests.length - 1] ??
    null;
  const activeResponse = activeRequest
    ? userDms.responses.get(activeRequest.requestId)
    : undefined;

  const activeStages = onchain.stageEvents.filter(
    (s) => s.contextId === activeRequest?.requestId,
  );

  const memberTimeline: StageRow[] = useMemo(() => {
    if (!isBiomeMember || !activeRequest) return [];
    return activeStages
      .map((s) => ({
        ts: s.ts,
        label: formatStage(s.stage, s.meta),
        verdict: (s.meta as { verdict?: string }).verdict,
        txHash: s.txHash,
        rootHash: s.rootHash,
      }))
      .sort((a, b) => a.ts - b.ts);
  }, [isBiomeMember, activeRequest, activeStages]);

  // Progress derivation (works for non-members too — based on what the
  // chain tells us about the user's own request and reply).
  const progressStep: 0 | 1 | 2 | 3 = useMemo(() => {
    if (!activeRequest) return 0;
    if (activeResponse) return 3;
    // If member-replied stages are visible (biome member), use them to
    // pick step 2; otherwise step 1 ("waiting on quorum") covers everything
    // between submit and final reply.
    const hasReplies = activeStages.some((s) => s.stage === "member-replied");
    return hasReplies ? 2 : 1;
  }, [activeRequest, activeResponse, activeStages]);

  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [memberTimeline.length, activeResponse]);

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
      const r = await submitRequestToCoordinator({
        coordinatorEns: COORDINATOR_ENS,
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

  const members =
    onchain.doc?.members ??
    Object.values(knownAgents)
      .filter((a) => a.role === "quorum")
      .map((a) => ({ ens: a.ens }));

  const coordinatorMeta = Object.values(knownAgents).find(
    (a) => a.ens === COORDINATOR_ENS,
  );

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
            via {COORDINATOR_ENS}
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
        {/* Left: roster + my requests */}
        <aside className="hidden lg:flex w-80 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto">
          <div className="p-4 border-b border-gray-800">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Coordinator
            </h2>
            <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3 flex items-center gap-3">
              <AgentAvatar slug="coordinator" size={32} />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-hermes-200 truncate">
                  {coordinatorMeta?.displayName ?? "Coordinator"}
                </p>
                <p className="text-xs font-mono text-gray-400 truncate">
                  {COORDINATOR_ENS}
                </p>
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  Receives your sealed request, dispatches to the quorum,
                  synthesises the response.
                </p>
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-gray-800">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              Quorum members ({members.length})
            </h2>
            <p className="text-xs text-gray-600 mb-3 leading-relaxed">
              Three independent personas. Each gets the same question over a
              sealed DM, replies with a one-paragraph verdict (
              <span className="text-emerald-400">agree</span> /{" "}
              <span className="text-red-400">disagree</span> /{" "}
              <span className="text-yellow-400">abstain</span>).
            </p>
            {members.map((m) => {
              const slug = m.ens.split(".")[0];
              const known = Object.values(knownAgents).find(
                (ka) => ka.ens === m.ens,
              );
              return (
                <div
                  key={m.ens}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-3 flex items-start gap-3 mb-2 hover:border-gray-700 transition-colors"
                >
                  <AgentAvatar slug={slug} size={28} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-gray-200">
                      {known?.displayName ?? slug}
                    </p>
                    <p className="text-xs font-mono text-gray-600 truncate">
                      {m.ens}
                    </p>
                    {known?.tagline && (
                      <p className="text-xs text-gray-500 mt-1 leading-snug">
                        {known.tagline}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {requests.length > 0 && (
            <div className="p-4">
              <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
                My requests
              </h2>
              <div className="flex flex-col gap-1">
                {requests
                  .slice()
                  .reverse()
                  .map((r) => {
                    const replied = userDms.responses.has(r.requestId);
                    const isActive = r.requestId === activeRequest?.requestId;
                    return (
                      <button
                        key={r.requestId}
                        onClick={() => setActiveRequestId(r.requestId)}
                        className={`text-left rounded-md border p-2 text-xs transition-colors ${
                          isActive
                            ? "border-hermes-700 bg-hermes-950/40"
                            : "border-gray-800 bg-gray-900 hover:border-gray-700"
                        }`}
                      >
                        <p className="text-gray-200 line-clamp-2">
                          {r.markdown}
                        </p>
                        <p className="text-xs font-mono text-gray-600 mt-1">
                          {replied ? (
                            <span className="text-emerald-400">✓ answered</span>
                          ) : (
                            <span className="text-yellow-400">… working</span>
                          )}{" "}
                          · {r.requestId.slice(0, 8)}
                        </p>
                      </button>
                    );
                  })}
              </div>
            </div>
          )}
        </aside>

        {/* Center: hero + submit + response */}
        <main className="flex flex-1 flex-col min-w-0">
          {/* Hero — only when no active request */}
          {!activeRequest && (
            <div className="flex-shrink-0 border-b border-gray-800 bg-gradient-to-br from-hermes-950/40 via-gray-950 to-gray-950 px-6 py-8">
              <div className="max-w-3xl mx-auto">
                <span className="inline-block text-[10px] font-mono uppercase tracking-widest text-hermes-400 border border-hermes-700/60 bg-hermes-950/40 rounded-full px-2.5 py-0.5 mb-3">
                  Live · Sepolia + 0G
                </span>
                <h1 className="text-3xl sm:text-4xl font-bold text-gray-100 leading-tight">
                  Ask an AI quorum.
                  <br />
                  <span className="text-hermes-400">No backend in the loop.</span>
                </h1>
                <p className="mt-4 text-gray-400 leading-relaxed max-w-2xl">
                  You hold an ENS subdomain. The coordinator and three quorum
                  agents each hold one too. Your question travels as a sealed
                  envelope on <strong className="text-gray-200">0G Storage</strong>,
                  pinned by a content hash on{" "}
                  <strong className="text-gray-200">HermesInbox</strong> —
                  ENS resolves identities, the chain provides the rendezvous,
                  the agents are autonomous.
                </p>
                <div className="mt-6 grid grid-cols-1 sm:grid-cols-4 gap-3">
                  <FlowCard
                    n={1}
                    title="You"
                    body="Seal your question for the coordinator's pubkey, upload to 0G, post the rootHash."
                  />
                  <FlowCard
                    n={2}
                    title="Coordinator"
                    body="Decrypts, fans the question out as sealed DMs to each quorum member."
                  />
                  <FlowCard
                    n={3}
                    title="Quorum"
                    body="Each agent reasons independently, replies with a verdict + paragraph."
                  />
                  <FlowCard
                    n={4}
                    title="Response"
                    body="Coordinator synthesises a final report and DMs it back to your inbox."
                  />
                </div>
              </div>
            </div>
          )}

          {/* Submit panel */}
          <div className="flex-shrink-0 border-b border-gray-800 p-4 sm:p-6">
            <div className="max-w-3xl mx-auto">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-gray-200">
                  Ask the quorum
                </h3>
                <span className="text-[10px] font-mono uppercase tracking-widest rounded px-2 py-0.5 border border-emerald-700 text-emerald-400">
                  public · sealed DM
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3 leading-relaxed">
                Anyone with a <code className="text-hermes-400">*.users.hermes.eth</code>{" "}
                subdomain can ask. The body is encrypted to{" "}
                <code className="text-gray-300">{COORDINATOR_ENS}</code>'s X25519
                pubkey — the coordinator is the only party that can read your
                question; everyone watching the chain sees opaque ciphertext.
              </p>
              <textarea
                className="w-full rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50 transition-colors"
                rows={4}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="e.g. Should the protocol upgrade to BLS aggregated signatures in v0.3?"
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
                    "Seal & send to coordinator"
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
              {userDms.error && (
                <p className="mt-2 text-xs text-red-400">
                  inbox poll: {userDms.error}
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

                  {/* Progress tracker */}
                  <ProgressTracker step={progressStep} />

                  {/* Member-only internal swarm view */}
                  {isBiomeMember && memberTimeline.length > 0 && (
                    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
                      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-3">
                        Internal swarm activity (member view)
                      </p>
                      <div className="space-y-2">
                        {memberTimeline.map((row, i) => (
                          <div
                            key={`${row.txHash}-${i}`}
                            className="flex items-start gap-3 text-sm"
                          >
                            <span className="text-emerald-400 mt-0.5">✓</span>
                            <div className="flex-1 min-w-0">
                              <p className="text-gray-200">
                                {row.label}
                                {row.verdict && (
                                  <span
                                    className={`ml-2 text-xs font-mono px-1.5 py-0.5 rounded border ${VERDICT_BG[row.verdict] ?? ""} ${VERDICT_COLORS[row.verdict] ?? ""}`}
                                  >
                                    {row.verdict}
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
                      </div>
                    </div>
                  )}

                  {/* Final response */}
                  {activeResponse && (
                    <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-5">
                      <div className="flex items-center justify-between mb-3">
                        <h4 className="text-xs font-mono font-semibold uppercase tracking-widest text-emerald-300">
                          Coordinator → you
                        </h4>
                        <TallyPills tally={activeResponse.tally} />
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

function FlowCard({
  n,
  title,
  body,
}: {
  n: number;
  title: string;
  body: string;
}) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-3">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-hermes-600/20 border border-hermes-600 text-hermes-300 text-xs font-mono font-semibold">
          {n}
        </span>
        <p className="text-sm font-semibold text-gray-100">{title}</p>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed">{body}</p>
    </div>
  );
}

function ProgressTracker({ step }: { step: 0 | 1 | 2 | 3 }) {
  const steps = [
    { label: "Sealed & sent", desc: "Your envelope is on chain." },
    { label: "Coordinator dispatching", desc: "Fanning out to quorum members." },
    { label: "Quorum deliberating", desc: "Verdicts coming in." },
    { label: "Synthesised", desc: "Coordinator wrote the final report." },
  ];
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-4">
        Round progress
      </p>
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const state =
            i < step ? "done" : i === step ? "active" : "pending";
          return (
            <li key={s.label} className="flex items-start gap-3">
              <div
                className={`flex-shrink-0 mt-0.5 inline-flex items-center justify-center w-5 h-5 rounded-full text-[10px] font-mono ${
                  state === "done"
                    ? "bg-emerald-500/20 border border-emerald-600 text-emerald-400"
                    : state === "active"
                      ? "bg-hermes-500/20 border border-hermes-600 text-hermes-300 animate-pulse"
                      : "bg-gray-800 border border-gray-700 text-gray-600"
                }`}
              >
                {state === "done" ? "✓" : i + 1}
              </div>
              <div className="flex-1">
                <p
                  className={`text-sm ${
                    state === "pending" ? "text-gray-500" : "text-gray-200"
                  }`}
                >
                  {s.label}
                </p>
                <p className="text-xs text-gray-600">{s.desc}</p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function TallyPills({ tally }: { tally: Record<string, number> }) {
  const entries = (
    ["agree", "disagree", "abstain"] as const
  ).filter((k) => (tally[k] ?? 0) > 0);
  if (entries.length === 0) return null;
  return (
    <div className="flex gap-1.5">
      {entries.map((k) => (
        <span
          key={k}
          className={`text-[10px] font-mono uppercase tracking-widest px-2 py-0.5 rounded-full border ${VERDICT_BG[k]} ${VERDICT_COLORS[k]}`}
        >
          {tally[k]} {k}
        </span>
      ))}
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
