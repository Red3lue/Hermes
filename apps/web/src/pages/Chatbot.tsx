import { useState, useEffect, useRef, useMemo } from "react";
import { AgentAvatar } from "@/components/AgentAvatar";
import { HermesShell } from "@/components/HermesShell";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useChatbotInbox } from "@/hooks/useChatbotInbox";
import { useChatHistory } from "@/hooks/useChatHistory";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { sendChatMessage } from "@/lib/chatClient";
import { deriveX25519FromWallet } from "@/lib/userIdentity";

const CONCIERGE_ENS =
  import.meta.env.VITE_CONCIERGE_ENS ?? "concierge.hermes.eth";

// A "conversation" in this UI is a single thread tag (`envelope.thread`).
// The concierge keys its history chain on (peer, thread), so each thread
// gets its own walkable manifest chain.
const DEFAULT_THREAD = "default";

type SentMessage = {
  thread: string;
  text: string;
  ts: number;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
};

type Bubble =
  | { side: "user"; text: string; ts: number; tx?: `0x${string}` }
  | {
      side: "concierge";
      text: string;
      ts: number;
      tx?: `0x${string}`;
      historyRoot?: `0x${string}`;
    };

const SENT_KEY = (userEns: string) => `hermes.chat.sent.${userEns}`;
const THREADS_KEY = (userEns: string) => `hermes.chat.threads.${userEns}`;
const ACTIVE_KEY = (userEns: string) => `hermes.chat.active.${userEns}`;
// Latest user-side history-chain root per (concierge, thread). Persisted
// so that a reload can resume the chain (`prev = lastRoot`) and the
// chain-walker can reconstruct the full transcript.
const USER_CHAIN_KEY = (userEns: string, conciergeEns: string, thread: string) =>
  `hermes.chat.userChain.${userEns}.${conciergeEns}.${thread}`;

function loadUserChainRoot(
  userEns: string,
  conciergeEns: string,
  thread: string,
): `0x${string}` | null {
  const v = localStorage.getItem(USER_CHAIN_KEY(userEns, conciergeEns, thread));
  return (v as `0x${string}` | null) ?? null;
}

function saveUserChainRoot(
  userEns: string,
  conciergeEns: string,
  thread: string,
  root: `0x${string}`,
) {
  localStorage.setItem(USER_CHAIN_KEY(userEns, conciergeEns, thread), root);
}

type ThreadMeta = {
  id: string;
  label: string;
  createdAt: number;
};

function loadSent(userEns: string | null): SentMessage[] {
  if (!userEns) return [];
  try {
    return JSON.parse(localStorage.getItem(SENT_KEY(userEns)) ?? "[]");
  } catch {
    return [];
  }
}

function saveSent(userEns: string, msgs: SentMessage[]) {
  try {
    localStorage.setItem(SENT_KEY(userEns), JSON.stringify(msgs));
  } catch {
    /* ignore */
  }
}

function loadThreads(userEns: string | null): ThreadMeta[] {
  if (!userEns) return [];
  try {
    const raw = JSON.parse(
      localStorage.getItem(THREADS_KEY(userEns)) ?? "[]",
    ) as ThreadMeta[];
    if (raw.length > 0) return raw;
  } catch {
    /* ignore */
  }
  // Seed a default thread so first-time users have somewhere to land.
  return [
    { id: DEFAULT_THREAD, label: "main", createdAt: Date.now() },
  ];
}

function saveThreads(userEns: string, threads: ThreadMeta[]) {
  try {
    localStorage.setItem(THREADS_KEY(userEns), JSON.stringify(threads));
  } catch {
    /* ignore */
  }
}

function loadActive(userEns: string | null): string {
  if (!userEns) return DEFAULT_THREAD;
  return localStorage.getItem(ACTIVE_KEY(userEns)) ?? DEFAULT_THREAD;
}

function saveActive(userEns: string, threadId: string) {
  try {
    localStorage.setItem(ACTIVE_KEY(userEns), threadId);
  } catch {
    /* ignore */
  }
}

export default function ChatbotPage() {
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

  const userEns = user.identity?.ens ?? null;

  // Threads + active selection
  const [threads, setThreads] = useState<ThreadMeta[]>(() =>
    loadThreads(userEns),
  );
  const [activeThread, setActiveThread] = useState<string>(() =>
    loadActive(userEns),
  );
  useEffect(() => {
    setThreads(loadThreads(userEns));
    setActiveThread(loadActive(userEns));
  }, [userEns]);
  useEffect(() => {
    if (userEns) saveThreads(userEns, threads);
  }, [userEns, threads]);
  useEffect(() => {
    if (userEns) saveActive(userEns, activeThread);
  }, [userEns, activeThread]);

  // All sent messages (across threads), persisted locally so reloads
  // keep both sides of the conversation visible.
  const [sent, setSent] = useState<SentMessage[]>(() => loadSent(userEns));
  useEffect(() => {
    setSent(loadSent(userEns));
  }, [userEns]);
  useEffect(() => {
    if (userEns) saveSent(userEns, sent);
  }, [userEns, sent]);

  // Concierge replies — pulled from chain. Each carries its envelope's
  // thread tag so we can route to the right conversation.
  const { messages: incoming, error: inboxError } = useChatbotInbox({
    userEns,
    userSecretKey: secretKey,
    conciergeEns: CONCIERGE_ENS,
  });

  // Build per-thread previews (last message + last activity ts + count)
  const threadPreviews = useMemo(() => {
    const m = new Map<
      string,
      { lastTs: number; lastText: string; count: number }
    >();
    for (const s of sent) {
      const cur = m.get(s.thread) ?? { lastTs: 0, lastText: "", count: 0 };
      cur.count += 1;
      if (s.ts > cur.lastTs) {
        cur.lastTs = s.ts;
        cur.lastText = s.text;
      }
      m.set(s.thread, cur);
    }
    for (const c of incoming) {
      const t = c.thread ?? DEFAULT_THREAD;
      const cur = m.get(t) ?? { lastTs: 0, lastText: "", count: 0 };
      cur.count += 1;
      if (c.ts > cur.lastTs) {
        cur.lastTs = c.ts;
        cur.lastText = c.text;
      }
      m.set(t, cur);
    }
    return m;
  }, [sent, incoming]);

  // Make sure every thread we've ever seen on chain or sent to is in the
  // sidebar. This auto-discovers threads from the inbox that the user
  // didn't create locally (e.g. a different browser).
  useEffect(() => {
    const existing = new Set(threads.map((t) => t.id));
    const fresh: ThreadMeta[] = [];
    for (const t of threadPreviews.keys()) {
      if (!existing.has(t)) {
        fresh.push({
          id: t,
          label: t === DEFAULT_THREAD ? "main" : t.slice(0, 8),
          createdAt: threadPreviews.get(t)?.lastTs ?? Date.now(),
        });
      }
    }
    if (fresh.length > 0) {
      setThreads((prev) => [...prev, ...fresh]);
    }
  }, [threadPreviews, threads]);

  // User-side chain root for the active thread, kept in component state
  // and mirrored to localStorage. Used as `prev` for the next send and
  // as the start root for chain-walk recovery.
  const [userChainRoot, setUserChainRoot] = useState<`0x${string}` | null>(
    null,
  );
  useEffect(() => {
    if (!userEns) return;
    setUserChainRoot(loadUserChainRoot(userEns, CONCIERGE_ENS, activeThread));
  }, [userEns, activeThread]);

  // Latest concierge chain root for the active thread — read off the
  // most recent reply's `envelope.history` field (which points at the
  // chain BEFORE that reply, i.e. covering all earlier replies).
  const conciergeChainRoot = useMemo<`0x${string}` | null>(() => {
    for (let i = incoming.length - 1; i >= 0; i--) {
      const c = incoming[i];
      if ((c.thread ?? DEFAULT_THREAD) !== activeThread) continue;
      if (c.history) return c.history;
    }
    return null;
  }, [incoming, activeThread]);

  // Chain-walk recovery: pulls full transcript for the active thread by
  // walking the concierge's chain (concierge replies, decryptable by us)
  // AND the user's own self-archive chain (user questions, decryptable
  // by us). Both encrypted, both signed, bodies recovered from manifest
  // entries. The localStorage `sent` cache is now a same-session
  // optimisation; chain walk is the source of truth across sessions.
  const { entries: walked } = useChatHistory({
    userEns,
    userPubkey: pubkey,
    userSecretKey: secretKey,
    conciergeEns: CONCIERGE_ENS,
    conciergeLatestHistoryRoot: conciergeChainRoot,
    userLatestHistoryRoot: userChainRoot,
    thread: activeThread,
  });

  // Filtered per-thread transcript for the main view. We dedupe by
  // rootHash so chain-walk results don't double up with same-session
  // localStorage `sent` and live inbox `incoming`.
  const transcript: Bubble[] = useMemo(() => {
    const seen = new Set<string>();
    const out: Bubble[] = [];

    function pushIfNew(rootHash: string, b: Bubble) {
      if (seen.has(rootHash)) return;
      seen.add(rootHash);
      out.push(b);
    }

    // Live data first (it has tx hashes / history roots we want to surface).
    for (const c of incoming) {
      const t = c.thread ?? DEFAULT_THREAD;
      if (t !== activeThread) continue;
      pushIfNew(c.rootHash, {
        side: "concierge",
        text: c.text,
        ts: c.ts,
        tx: c.txHash,
        historyRoot: c.history,
      });
    }
    for (const s of sent) {
      if (s.thread !== activeThread) continue;
      pushIfNew(s.rootHash, {
        side: "user",
        text: s.text,
        ts: s.ts,
        tx: s.txHash,
      });
    }

    // Chain-walk fills in anything we don't already have (older sessions,
    // fresh-browser case). `ts` from manifest entries is unix seconds.
    for (const w of walked) {
      pushIfNew(w.rootHash, {
        side: w.side,
        text: w.text,
        ts: w.ts * 1000,
      });
    }

    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [sent, incoming, walked, activeThread]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript.length, activeThread]);

  async function send() {
    if (!draft.trim()) return;
    if (!walletClient || !userEns || !pubkey || !secretKey) {
      setSendError("connect wallet + complete user setup first");
      return;
    }
    const text = draft.trim();
    setSending(true);
    setSendError(null);
    try {
      const priorRoot = loadUserChainRoot(
        userEns,
        CONCIERGE_ENS,
        activeThread,
      );
      const r = await sendChatMessage({
        conciergeEns: CONCIERGE_ENS,
        userEns,
        userPubkey: pubkey,
        userSecretKey: secretKey,
        text,
        thread: activeThread,
        priorHistoryRoot: priorRoot ?? undefined,
        walletClient,
      });
      saveUserChainRoot(userEns, CONCIERGE_ENS, activeThread, r.historyRoot);
      setUserChainRoot(r.historyRoot);
      setSent((prev) => [
        ...prev,
        {
          thread: activeThread,
          text,
          ts: Date.now(),
          txHash: r.tx,
          rootHash: r.rootHash,
        },
      ]);
      setDraft("");
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function newConversation() {
    const id = crypto.randomUUID();
    const meta: ThreadMeta = {
      id,
      label: `chat-${threads.length + 1}`,
      createdAt: Date.now(),
    };
    setThreads((prev) => [...prev, meta]);
    setActiveThread(id);
  }

  function clearLocalForActive() {
    if (
      !confirm(
        "Clear locally cached messages for this conversation? On-chain history is preserved and will re-sync from the concierge's history chain.",
      )
    ) {
      return;
    }
    setSent((prev) => prev.filter((s) => s.thread !== activeThread));
  }

  const conciergeMeta = Object.values(knownAgents).find(
    (a) => a.ens === CONCIERGE_ENS,
  );
  const lastSentInThread = useMemo(
    () => [...sent].reverse().find((s) => s.thread === activeThread),
    [sent, activeThread],
  );
  const lastIncomingInThread = useMemo(
    () =>
      [...incoming].reverse().find((c) => (c.thread ?? DEFAULT_THREAD) === activeThread),
    [incoming, activeThread],
  );
  const waitingForReply =
    !!lastSentInThread &&
    (!lastIncomingInThread || lastIncomingInThread.ts < lastSentInThread.ts);

  // Sort threads by last activity desc
  const sortedThreads = useMemo(
    () =>
      [...threads].sort((a, b) => {
        const aTs = threadPreviews.get(a.id)?.lastTs ?? a.createdAt;
        const bTs = threadPreviews.get(b.id)?.lastTs ?? b.createdAt;
        return bTs - aTs;
      }),
    [threads, threadPreviews],
  );

  const activeMeta = threads.find((t) => t.id === activeThread);

  const rightSlot = (
    <>
      <span className="hidden sm:inline-flex pill-cyan">
        with {CONCIERGE_ENS}
      </span>
      {userEns && (
        <span className="hidden md:inline-flex pill-mint">
          you · {userEns}
        </span>
      )}
    </>
  );

  return (
    <HermesShell
      full
      compact
      crumbs={[{ label: "demos", to: "/demos" }, { label: "chatbot" }]}
      rightSlot={rightSlot}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
      {address && user.status !== "ready" && <UserSetupBanner user={user} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: identity + conversations */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r border-hermes-700/20 overflow-y-auto bg-ink-900/40 backdrop-blur-sm">
          <div className="p-4 border-b border-hermes-700/20">
            <div className="panel-neon p-3 flex items-center gap-3">
              <AgentAvatar slug="concierge" size={36} />
              <div className="min-w-0">
                <p className="font-display text-sm font-semibold text-hermes-200 truncate">
                  {conciergeMeta?.displayName ?? "Concierge"}
                </p>
                <p className="text-[11px] font-mono text-gray-400 truncate">
                  {CONCIERGE_ENS}
                </p>
                {conciergeMeta?.tagline && (
                  <p className="text-xs text-gray-500 mt-1 leading-snug">
                    {conciergeMeta.tagline}
                  </p>
                )}
              </div>
            </div>
          </div>

          <div className="p-4 border-b border-hermes-700/20">
            <div className="flex items-center justify-between mb-3">
              <p className="eyebrow">Conversations</p>
              <button
                onClick={newConversation}
                className="text-[11px] font-mono text-hermes-300 hover:text-hermes-200 border border-hermes-500/40 hover:border-hermes-500 rounded px-2 py-0.5 transition-colors"
              >
                + new
              </button>
            </div>
            <div className="space-y-1.5">
              {sortedThreads.map((t) => {
                const preview = threadPreviews.get(t.id);
                const isActive = t.id === activeThread;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveThread(t.id)}
                    className={`w-full text-left rounded-md border p-2.5 transition-all ${
                      isActive
                        ? "border-hermes-500/60 bg-hermes-950/40 shadow-neon-cyan"
                        : "border-hermes-700/20 bg-ink-900/60 hover:border-hermes-500/40"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <p className="text-xs font-mono text-gray-200 truncate">
                        {t.label}
                      </p>
                      {preview && (
                        <span className="text-[10px] font-mono text-gray-500">
                          {new Date(preview.lastTs).toLocaleDateString(
                            undefined,
                            { month: "short", day: "numeric" },
                          )}
                        </span>
                      )}
                    </div>
                    <p className="text-[11px] text-gray-500 truncate mt-0.5">
                      {preview?.lastText ?? "no messages yet"}
                    </p>
                    <p className="text-[10px] font-mono text-gray-600 mt-0.5">
                      {preview?.count ?? 0} msg{(preview?.count ?? 0) === 1 ? "" : "s"}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-4 text-xs text-gray-500 leading-relaxed">
            <p className="eyebrow mb-2">How threads work</p>
            <p className="mb-2">
              Each conversation is a <code className="text-hermes-300">thread</code>{" "}
              tag on the envelope. The concierge keeps a separate history
              chain per (you, thread) — so old conversations stay walkable
              from chain even on a fresh browser.
            </p>
            {sent.filter((s) => s.thread === activeThread).length > 0 && (
              <button
                onClick={clearLocalForActive}
                className="text-gray-500 hover:text-red-400 underline-offset-2 hover:underline mt-2"
              >
                clear local cache for this conversation
              </button>
            )}
          </div>
        </aside>

        {/* Center: transcript + composer */}
        <main className="flex flex-1 flex-col min-w-0">
          {activeMeta && (
            <div className="flex-shrink-0 border-b border-hermes-700/20 px-4 py-2 bg-ink-900/50 flex items-center gap-3">
              <span className="eyebrow">conversation</span>
              <span className="text-sm text-gray-200 font-mono">
                {activeMeta.label}
              </span>
              <span className="text-[10px] font-mono text-gray-600 ml-2">
                thread={activeThread.slice(0, 12)}
                {activeThread.length > 12 && "…"}
              </span>
              {(() => {
                const latestRoot = [...incoming]
                  .reverse()
                  .find(
                    (c) =>
                      (c.thread ?? DEFAULT_THREAD) === activeThread && c.history,
                  )?.history;
                if (!latestRoot) return null;
                return (
                  <span className="text-[10px] font-mono text-gray-500 ml-auto">
                    history root · {latestRoot.slice(0, 12)}…
                  </span>
                );
              })()}
            </div>
          )}

          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3"
          >
            {transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-500 gap-4 py-12">
                <span className="text-hermes-300">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="drop-shadow-[0_0_12px_rgba(44,199,255,0.5)]"><path d="M12 2a5 5 0 015 5v3h.5A2.5 2.5 0 0120 12.5v6A2.5 2.5 0 0117.5 21h-11A2.5 2.5 0 014 18.5v-6A2.5 2.5 0 016.5 10H7V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v3h6V7a3 3 0 00-3-3z" fill="currentColor" fillOpacity="0.15"/></svg>
                </span>
                <p className="font-display text-sm uppercase tracking-[0.18em] text-gray-300">
                  Encrypted 1:1 with the concierge
                </p>
                <p className="text-sm max-w-md leading-relaxed">
                  Every message is sealed in your browser, traverses Sepolia +
                  0G, and arrives at{" "}
                  <code className="text-hermes-300">{CONCIERGE_ENS}</code>.
                </p>
                {!userEns && (
                  <p className="text-xs text-gray-600 max-w-md">
                    Connect a wallet and complete user setup to start.
                  </p>
                )}
              </div>
            )}

            {transcript.map((b, i) => (
              <Bubble key={`${b.ts}-${i}`} bubble={b} />
            ))}

            {waitingForReply && (
              <div className="flex items-center gap-2 text-xs text-gray-500 italic px-2">
                <span className="animate-pulse">●</span>
                <span>Concierge is decrypting and thinking…</span>
              </div>
            )}
          </div>

          <div className="flex-shrink-0 border-t border-hermes-700/20 p-4 bg-ink-900/50 backdrop-blur-sm">
            <div className="flex gap-2 items-end">
              <textarea
                className="flex-1 rounded-lg border border-hermes-700/40 bg-ink-900/80 px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:border-hermes-400 focus:shadow-neon-cyan focus:outline-none disabled:opacity-50 transition-all"
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder={
                  user.status === "ready"
                    ? "Type a message… (Enter to send · Shift+Enter for newline)"
                    : "Complete user setup to start chatting…"
                }
                disabled={user.status !== "ready" || sending}
              />
              <button
                onClick={send}
                disabled={
                  sending || !draft.trim() || user.status !== "ready"
                }
                className="btn-neon"
              >
                {sending ? "Sealing…" : "Send →"}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] font-mono text-gray-500">
                1 wallet sig · 1 0G upload · 1 Sepolia tx · history-chained
              </span>
              {sendError && (
                <span className="text-xs text-red-400">{sendError}</span>
              )}
              {keyError && (
                <span className="text-xs text-red-400">
                  key derivation: {keyError}
                </span>
              )}
              {inboxError && (
                <span className="text-xs text-red-400">
                  inbox poll: {inboxError}
                </span>
              )}
            </div>
          </div>
        </main>
      </div>
      </div>
    </HermesShell>
  );
}

function Bubble({ bubble }: { bubble: Bubble }) {
  const isUser = bubble.side === "user";
  return (
    <div
      className={`flex ${isUser ? "justify-end" : "justify-start"} gap-2`}
    >
      {!isUser && (
        <div className="flex-shrink-0 mt-1">
          <AgentAvatar slug="concierge" size={30} />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2.5 ${
          isUser
            ? "bg-gradient-to-br from-hermes-600/40 to-flux-700/30 border border-hermes-500/50 rounded-br-sm shadow-neon-cyan"
            : "bg-ink-900/80 border border-hermes-700/30 rounded-bl-sm backdrop-blur-sm"
        }`}
      >
        <pre className="whitespace-pre-wrap text-sm text-gray-100 font-sans leading-relaxed">
          {bubble.text}
        </pre>
        <div className="mt-1.5 flex gap-2 text-[10px] font-mono text-gray-500">
          <span>{new Date(bubble.ts).toLocaleTimeString()}</span>
          {bubble.tx && (
            <a
              href={`https://sepolia.etherscan.io/tx/${bubble.tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-hermes-300 hover:text-hermes-200"
            >
              tx ↗
            </a>
          )}
          {bubble.side === "concierge" && bubble.historyRoot && (
            <span title={bubble.historyRoot}>
              prev chain · {bubble.historyRoot.slice(0, 10)}…
            </span>
          )}
        </div>
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
    <div className="flex-shrink-0 px-4 py-2 border-b border-flux-700/30 bg-flux-950/30 text-sm flex items-center gap-3">
      <span className="text-flux-300">⚠</span>
      <span className="text-gray-200 flex-1">{label}</span>
      {user.error && (
        <span className="text-xs text-red-400">{user.error}</span>
      )}
      <button
        onClick={actions[user.status]}
        disabled={user.busy}
        className="btn-neon !px-3 !py-1 !text-[11px]"
      >
        {user.busy ? "…" : "continue"}
      </button>
    </div>
  );
}
