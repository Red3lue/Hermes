import { useState, useEffect, useRef, useMemo } from "react";
import { Link } from "react-router-dom";
import { WalletButton } from "@/components/WalletButton";
import { AgentAvatar } from "@/components/AgentAvatar";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useChatbotInbox } from "@/hooks/useChatbotInbox";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { sendChatMessage } from "@/lib/chatClient";
import { deriveX25519FromWallet } from "@/lib/userIdentity";

const CONCIERGE_ENS =
  import.meta.env.VITE_CONCIERGE_ENS ?? "concierge.hermes.eth";

type SentMessage = {
  text: string;
  ts: number;
  txHash: `0x${string}`;
  rootHash: `0x${string}`;
  pending: boolean;
};

type Bubble =
  | { side: "user"; text: string; ts: number; tx?: `0x${string}`; pending?: boolean }
  | { side: "concierge"; text: string; ts: number; tx: `0x${string}` };

const STORAGE_KEY = (userEns: string) => `hermes.chat.${userEns}`;

function loadSent(userEns: string | null): SentMessage[] {
  if (!userEns) return [];
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY(userEns)) ?? "[]");
  } catch {
    return [];
  }
}

function saveSent(userEns: string, msgs: SentMessage[]) {
  try {
    localStorage.setItem(STORAGE_KEY(userEns), JSON.stringify(msgs));
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

  // Remember sent messages locally so a reload still shows the user's
  // half of the conversation (we can't decrypt our own outgoing messages
  // — they're sealed for the concierge).
  const userEns = user.identity?.ens ?? null;
  const [sent, setSent] = useState<SentMessage[]>(() => loadSent(userEns));
  useEffect(() => {
    setSent(loadSent(userEns));
  }, [userEns]);
  useEffect(() => {
    if (userEns) saveSent(userEns, sent);
  }, [userEns, sent]);

  const { messages: incoming, error: inboxError } = useChatbotInbox({
    userEns,
    userSecretKey: secretKey,
    conciergeEns: CONCIERGE_ENS,
  });

  // Merge sent + received into a single transcript, sorted by timestamp.
  const transcript: Bubble[] = useMemo(() => {
    const out: Bubble[] = [];
    for (const s of sent) {
      out.push({
        side: "user",
        text: s.text,
        ts: s.ts,
        tx: s.txHash,
        pending: s.pending,
      });
    }
    for (const c of incoming) {
      out.push({
        side: "concierge",
        text: c.text,
        ts: c.ts,
        tx: c.txHash,
      });
    }
    out.sort((a, b) => a.ts - b.ts);
    return out;
  }, [sent, incoming]);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (transcriptRef.current) {
      transcriptRef.current.scrollTop = transcriptRef.current.scrollHeight;
    }
  }, [transcript.length]);

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
      const r = await sendChatMessage({
        conciergeEns: CONCIERGE_ENS,
        userEns,
        userPubkey: pubkey,
        userSecretKey: secretKey,
        text,
        walletClient,
      });
      setSent((prev) => [
        ...prev,
        {
          text,
          ts: Date.now(),
          txHash: r.tx,
          rootHash: r.rootHash,
          pending: false,
        },
      ]);
      setDraft("");
    } catch (err) {
      setSendError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  function clearTranscript() {
    if (!confirm("Clear local transcript? On-chain history is preserved.")) {
      return;
    }
    setSent([]);
    if (userEns) saveSent(userEns, []);
  }

  const conciergeMeta = Object.values(knownAgents).find(
    (a) => a.ens === CONCIERGE_ENS,
  );
  const waitingForReply =
    sent.length > 0 &&
    (incoming.length === 0 ||
      sent[sent.length - 1].ts > incoming[incoming.length - 1].ts);

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
        <span className="text-gray-300 text-sm font-semibold">chatbot</span>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs font-mono text-gray-600 hidden sm:block">
            with {CONCIERGE_ENS}
          </span>
          {userEns && (
            <span className="text-xs font-mono text-emerald-400 hidden md:block">
              you: {userEns}
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {address && user.status !== "ready" && <UserSetupBanner user={user} />}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: concierge identity card */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto p-4 gap-4">
          <div className="rounded-lg border border-hermes-800 bg-hermes-950/30 p-3 flex items-center gap-3">
            <AgentAvatar slug="concierge" size={32} />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-hermes-200 truncate">
                {conciergeMeta?.displayName ?? "Concierge"}
              </p>
              <p className="text-xs font-mono text-gray-400 truncate">
                {CONCIERGE_ENS}
              </p>
              {conciergeMeta?.tagline && (
                <p className="text-xs text-gray-500 mt-1 leading-snug">
                  {conciergeMeta.tagline}
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-3 text-xs text-gray-500 leading-relaxed">
            <p className="mb-2 text-gray-300 font-semibold">How this works</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Your message is sealed for the concierge's pubkey.</li>
              <li>
                The envelope is uploaded to 0G Storage; the rootHash is
                appended to <code>HermesInbox</code> on Sepolia.
              </li>
              <li>
                The concierge's runtime polls its inbox, decrypts, calls
                Claude, and sends a sealed reply back to your inbox.
              </li>
              <li>
                Your browser polls your inbox, decrypts the reply, and
                renders it here.
              </li>
            </ol>
            <p className="mt-2 text-gray-700">
              On chain, observers see only ciphertext rootHashes — never
              your message text.
            </p>
          </div>

          {sent.length > 0 && (
            <button
              onClick={clearTranscript}
              className="text-xs text-gray-600 hover:text-red-400 text-left"
            >
              clear local transcript
            </button>
          )}
        </aside>

        {/* Center: transcript + composer */}
        <main className="flex flex-1 flex-col min-w-0">
          <div
            ref={transcriptRef}
            className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3"
          >
            {transcript.length === 0 && (
              <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3 py-12">
                <p className="text-2xl">🔐</p>
                <p className="text-sm max-w-md">
                  Encrypted 1:1 chat with the concierge. Every message is
                  sealed in your browser, traverses Sepolia + 0G, and
                  arrives at <code className="text-hermes-400">{CONCIERGE_ENS}</code>.
                </p>
                {!userEns && (
                  <p className="text-xs text-gray-700 max-w-md">
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

          {/* Composer */}
          <div className="flex-shrink-0 border-t border-gray-800 p-4 bg-gray-950">
            <div className="flex gap-2 items-end">
              <textarea
                className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-gray-200 font-mono resize-none focus:border-hermes-600 focus:outline-none disabled:opacity-50"
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
                className="rounded-lg bg-hermes-600 px-4 py-3 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
              >
                {sending ? "Sealing…" : "Send"}
              </button>
            </div>
            <div className="flex items-center gap-3 mt-2">
              <span className="text-[11px] font-mono text-gray-700">
                1 wallet sig · 1 0G upload · 1 Sepolia tx per message
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
          <AgentAvatar slug="concierge" size={28} />
        </div>
      )}
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? "bg-hermes-600/30 border border-hermes-700 rounded-br-sm"
            : "bg-gray-900 border border-gray-800 rounded-bl-sm"
        }`}
      >
        <pre className="whitespace-pre-wrap text-sm text-gray-100 font-sans leading-relaxed">
          {bubble.text}
        </pre>
        <div className="mt-1.5 flex gap-2 text-[10px] font-mono text-gray-600">
          <span>{new Date(bubble.ts).toLocaleTimeString()}</span>
          {bubble.tx && (
            <a
              href={`https://sepolia.etherscan.io/tx/${bubble.tx}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-hermes-400 hover:text-hermes-300"
            >
              tx ↗
            </a>
          )}
          {(bubble as { pending?: boolean }).pending && (
            <span className="text-yellow-500">pending</span>
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
    <div className="flex-shrink-0 px-4 py-2 border-b border-yellow-900 bg-yellow-950/20 text-sm flex items-center gap-3">
      <span className="text-yellow-400">⚠</span>
      <span className="text-gray-300 flex-1">{label}</span>
      {user.error && (
        <span className="text-xs text-red-400">{user.error}</span>
      )}
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
