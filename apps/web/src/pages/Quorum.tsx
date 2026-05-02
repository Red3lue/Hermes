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

  // Track requests this user has submitted in this session (chain is the
  // canonical record; this is just for ordering + the active-request panel).
  const [requests, setRequests] = useState<RequestRow[]>([]);
  const [activeRequestId, setActiveRequestId] = useState<string | null>(null);

  // Coordinator → user reply stream (pure on-chain read of user's own inbox)
  const userDms = useUserDmInbox({
    userEns: user.identity?.ens ?? null,
    userSecretKey: secretKey,
  });

  // Optional member-only view: if the user happens to also be a biome
  // member, render the internal swarm activity. Non-members see an empty
  // doc/error from this hook and we silently hide that panel.
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

  // For biome members: show the internal stages for the active round.
  const activeStages = onchain.stageEvents.filter(
    (s) => s.contextId === activeRequest?.requestId,
  );
  const activeReport = onchain.reportEvents.find(
    (r) => r.contextId === activeRequest?.requestId,
  );

  const memberTimeline: StageRow[] = useMemo(() => {
    if (!isBiomeMember || !activeRequest) return [];
    const rows: StageRow[] = [];
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
    return rows.sort((a, b) => a.ts - b.ts);
  }, [isBiomeMember, activeRequest, activeStages, activeReport]);

  // Submit
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

  // Public roster: prefer the on-chain BiomeDoc when the user is a member
  // (authoritative). Fall back to the static known-agents.json filtered to
  // quorum role so non-members still see who's deliberating.
  const members =
    onchain.doc?.members ??
    Object.values(knownAgents)
      .filter((a) => a.role === "quorum")
      .map((a) => ({ ens: a.ens }));

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

      {/* User setup banner */}
      {address && user.status !== "ready" && <UserSetupBanner user={user} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: members + my requests */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto p-4 gap-4">
          <div>
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
              Quorum ({members.length})
            </h2>
            <p className="text-xs text-gray-600 mb-3">
              Coordinator routes your sealed request into the biome → members
              deliberate → reporter posts → coordinator DMs you the result.
            </p>
            {members.map((m) => {
              const slug = m.ens.split(".")[0];
              const known = Object.values(knownAgents).find(
                (ka) => ka.ens === m.ens,
              );
              return (
                <div
                  key={m.ens}
                  className="rounded-lg border border-gray-800 bg-gray-900 p-2 flex items-center gap-2 mb-2"
                >
                  <AgentAvatar slug={slug} size={24} />
                  <div className="min-w-0">
                    <p className="text-xs font-mono text-gray-300 truncate">
                      {m.ens}
                    </p>
                    {known?.displayName && (
                      <p className="text-xs text-gray-600">
                        {known.displayName}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {requests.length > 0 && (
            <div>
              <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
                My requests
              </h2>
              <div className="flex flex-col gap-1">
                {requests.map((r) => {
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
                      <p className="text-gray-200 truncate">{r.markdown}</p>
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

        {/* Center: submit + response */}
        <main className="flex flex-1 flex-col min-w-0 border-r border-gray-800">
          {/* Submit panel */}
          <div className="flex-shrink-0 border-b border-gray-800 p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
                Ask the quorum
              </h3>
              <span className="text-xs rounded px-1.5 py-0.5 border border-emerald-700 text-emerald-400">
                public · sealed DM
              </span>
            </div>
            <p className="text-xs text-gray-500 mb-2">
              Any registered <code>*.users.hermes.eth</code> subdomain can ask
              the coordinator. Body is sealed for the coordinator's pubkey;
              only the coordinator can read it.
            </p>
            <textarea
              className="w-full rounded-lg border border-gray-700 bg-gray-900 p-3 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50"
              rows={5}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Ask a question for the agents to deliberate on…"
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
                {submitting
                  ? "Sealing & sending…"
                  : "Seal & send to coordinator"}
              </button>
              {submitError && (
                <span className="text-xs text-red-400">{submitError}</span>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-700">
              1 wallet sig · 1 0G upload · 1 Sepolia tx · coordinator picks up
              within ~5s
            </p>
            {keyError && (
              <p className="mt-1 text-xs text-red-400">
                key derivation: {keyError}
              </p>
            )}
            {userDms.error && (
              <p className="mt-1 text-xs text-red-400">
                inbox poll: {userDms.error}
              </p>
            )}
          </div>

          {/* Active request + response */}
          <div ref={transcriptRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {!activeRequest && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3 py-12">
                <p className="text-2xl">🗳️</p>
                <p className="text-sm max-w-md">
                  No active request. Submit one above. Your sealed envelope
                  goes to <code className="text-hermes-400">{COORDINATOR_ENS}</code>;
                  the response will land in <code className="text-hermes-400">{user.identity?.ens ?? "your inbox"}</code>.
                </p>
              </div>
            )}

            {activeRequest && (
              <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3">
                <p className="text-xs font-mono text-hermes-300 mb-1">
                  Your question
                </p>
                <p className="text-sm text-gray-200 whitespace-pre-wrap">
                  {activeRequest.markdown}
                </p>
                <div className="mt-2 flex gap-3 text-xs font-mono text-gray-600">
                  <a
                    href={`https://sepolia.etherscan.io/tx/${activeRequest.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hermes-400 hover:text-hermes-300"
                  >
                    request tx: {activeRequest.txHash.slice(0, 12)}…
                  </a>
                  <span>root: {activeRequest.rootHash.slice(0, 12)}…</span>
                </div>
              </div>
            )}

            {/* Member-only internal swarm view */}
            {isBiomeMember && memberTimeline.length > 0 && (
              <div className="rounded-md border border-gray-800 bg-gray-900/40 p-3">
                <p className="text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
                  Coordinator's biome activity (member view)
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
                </div>
              </div>
            )}

            {/* Working spinner if no response yet */}
            {activeRequest && !activeResponse && (
              <div className="rounded-md border border-yellow-900/50 bg-yellow-950/20 p-3 text-sm text-yellow-300/80 flex items-center gap-3">
                <span className="animate-pulse">●</span>
                <span>
                  Coordinator received the sealed envelope. Quorum is
                  deliberating… reply will arrive at your inbox shortly.
                </span>
              </div>
            )}

            {/* Final response */}
            {activeResponse && (
              <div className="rounded-lg border border-emerald-800 bg-emerald-950/20 p-4 mt-4">
                <h4 className="text-xs font-mono font-semibold uppercase tracking-widest text-emerald-300 mb-3">
                  Coordinator → you
                </h4>
                <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed">
                  {activeResponse.markdown}
                </pre>
                <div className="mt-3 pt-3 border-t border-emerald-900 flex flex-wrap gap-3 text-xs font-mono text-gray-600">
                  <a
                    href={`https://sepolia.etherscan.io/tx/${activeResponse.txHash}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-hermes-400 hover:text-hermes-300"
                  >
                    response tx: {activeResponse.txHash.slice(0, 12)}…
                  </a>
                  <span>root: {activeResponse.rootHash.slice(0, 14)}…</span>
                  <span>
                    tally:{" "}
                    {Object.entries(activeResponse.tally)
                      .map(([k, v]) => `${v} ${k}`)
                      .join(", ")}
                  </span>
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
