import { useState, useEffect, useRef, useCallback } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { api, type AgentInfo, type ChatMessage } from "@/lib/api";
import { useWallet } from "@/hooks/useWallet";
import { deriveSessionKey, newSessionId, type SessionKey } from "@/lib/sessionKey";
import {
  loadSessions,
  upsertSession,
  deleteSession,
  deriveTitle,
  type ChatSession,
} from "@/lib/chatHistory";

const AGENT_SLUG = "concierge";

function RawEnvelopePanel({ msg }: { msg: ChatMessage }) {
  const fake = {
    v: 1,
    from:
      msg.role === "user" ? "visitor.hermes.eth" : `${AGENT_SLUG}.hermes.eth`,
    to: msg.role === "user" ? `${AGENT_SLUG}.hermes.eth` : "visitor.hermes.eth",
    ts: msg.ts,
    nonce: msg.id.replace(/-/g, "").slice(0, 16),
    ciphertext: btoa(`<sealed-box: ${msg.text.slice(0, 8)}…>`),
    ephemeralPubKey: btoa("EPK:" + msg.id.slice(0, 8)),
    sig: "0x" + msg.id.replace(/-/g, "") + "00000000",
    rootHash: msg.rootHash,
  };
  return (
    <pre className="text-xs text-gray-300 font-mono whitespace-pre-wrap break-all leading-relaxed">
      {JSON.stringify(fake, null, 2)}
    </pre>
  );
}

export default function ChatbotPage() {
  const { address, walletClient } = useWallet();
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [sessionKey, setSessionKey] = useState<SessionKey | null>(null);
  const [signing, setSigning] = useState(false);
  const [signError, setSignError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const [showPersona, setShowPersona] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load agent metadata once
  useEffect(() => {
    api.agents
      .get(AGENT_SLUG)
      .then(setAgent)
      .catch(() => {});
  }, []);

  // When wallet disconnects, clear the in-memory key (cached sig stays in
  // sessionStorage until tab close).
  useEffect(() => {
    if (!address) {
      setSessionKey(null);
      setSessions([]);
      setActiveId(null);
    }
  }, [address]);

  const unlock = useCallback(async () => {
    if (!walletClient || !address) return;
    setSigning(true);
    setSignError(null);
    try {
      const sk = await deriveSessionKey(walletClient, address);
      setSessionKey(sk);
      const stored = loadSessions(address, AGENT_SLUG);
      setSessions(stored);
      setActiveId(stored[0]?.id ?? null);
    } catch (err) {
      setSignError((err as Error).message);
    } finally {
      setSigning(false);
    }
  }, [walletClient, address]);

  function startNewSession() {
    if (!sessionKey || !address) return;
    const id = newSessionId(sessionKey);
    const session: ChatSession = {
      id,
      createdAt: Date.now(),
      title: "New chat",
      messages: [],
    };
    upsertSession(address, AGENT_SLUG, session);
    setSessions([session, ...sessions]);
    setActiveId(id);
  }

  function removeSession(id: string) {
    if (!address) return;
    deleteSession(address, AGENT_SLUG, id);
    const remaining = sessions.filter((s) => s.id !== id);
    setSessions(remaining);
    if (activeId === id) setActiveId(remaining[0]?.id ?? null);
  }

  const active = sessions.find((s) => s.id === activeId) ?? null;
  const messages = active?.messages ?? [];

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  async function send() {
    const text = input.trim();
    if (!text || sending || !address || !sessionKey) return;

    // Lazy-create a session if none active
    let sid = activeId;
    if (!sid) {
      const id = newSessionId(sessionKey);
      const fresh: ChatSession = {
        id,
        createdAt: Date.now(),
        title: "New chat",
        messages: [],
      };
      upsertSession(address, AGENT_SLUG, fresh);
      setSessions([fresh, ...sessions]);
      setActiveId(id);
      sid = id;
    }

    setInput("");
    setSending(true);
    try {
      const result = await api.chatbot.sendMessage(AGENT_SLUG, text, sid);
      const updated: ChatSession = {
        id: sid,
        createdAt: active?.createdAt ?? Date.now(),
        title: active?.title && active.title !== "New chat"
          ? active.title
          : deriveTitle([result.userMessage]),
        messages: [...messages, result.userMessage, result.agentMessage],
      };
      upsertSession(address, AGENT_SLUG, updated);
      setSessions((prev) => {
        const without = prev.filter((s) => s.id !== sid);
        return [updated, ...without];
      });
    } catch (err) {
      console.error("send error:", err);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  const locked = !sessionKey;

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
        <span className="text-gray-300 text-sm font-semibold">
          secret chatbot
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setShowPersona((v) => !v)}
            className={`text-xs border rounded px-2 py-1 transition-colors ${showPersona ? "border-hermes-600 text-hermes-300 bg-hermes-950/40" : "border-gray-700 text-gray-500 hover:text-gray-300"}`}
          >
            persona
          </button>
          <WalletButton />
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
        {/* Sessions sidebar */}
        <aside className="hidden md:flex w-64 flex-shrink-0 flex-col border-r border-gray-800 overflow-hidden">
          <div className="px-3 py-3 border-b border-gray-800 flex items-center justify-between">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
              Sessions
            </h2>
            <button
              onClick={startNewSession}
              disabled={locked}
              className="text-xs rounded border border-gray-700 px-2 py-0.5 text-gray-300 hover:border-hermes-600 hover:text-hermes-300 disabled:opacity-30 disabled:cursor-not-allowed"
              title={locked ? "Connect wallet first" : "New chat"}
            >
              + new
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {locked && (
              <p className="text-xs text-gray-600 px-2 py-3">
                Connect your wallet and sign to unlock chat history.
              </p>
            )}
            {!locked && sessions.length === 0 && (
              <p className="text-xs text-gray-600 px-2 py-3">
                No chats yet. Click <span className="text-gray-400">+ new</span> or
                send a message to start.
              </p>
            )}
            {sessions.map((s) => (
              <div
                key={s.id}
                className={`group rounded px-2 py-2 text-xs cursor-pointer flex items-start gap-2 ${
                  s.id === activeId
                    ? "bg-hermes-950/50 border border-hermes-800"
                    : "border border-transparent hover:bg-gray-900"
                }`}
                onClick={() => setActiveId(s.id)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-gray-200 truncate">{s.title}</p>
                  <p className="font-mono text-gray-600 text-[10px] mt-0.5">
                    {new Date(s.createdAt).toLocaleString()} · {s.messages.length} msg
                  </p>
                </div>
                <button
                  className="opacity-0 group-hover:opacity-100 text-gray-600 hover:text-red-400 transition-opacity"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSession(s.id);
                  }}
                  title="Delete"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
          {address && (
            <div className="border-t border-gray-800 px-3 py-2 text-[10px] font-mono text-gray-600 truncate">
              {address.slice(0, 8)}…{address.slice(-4)}
            </div>
          )}
        </aside>

        {/* Chat area */}
        <div className="flex flex-1 flex-col min-w-0">
          {/* Agent header */}
          <div className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
            {agent && <AgentAvatar slug={agent.slug} size={36} />}
            <div>
              <p className="font-semibold capitalize">{AGENT_SLUG}</p>
              <p className="text-xs font-mono text-gray-500">
                {agent?.ens ?? `${AGENT_SLUG}.hermes.eth`}
              </p>
            </div>
            <div className="ml-auto">
              <div className="flex items-center gap-1.5 text-xs text-emerald-400">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
                online
              </div>
            </div>
          </div>

          {/* Lock screen */}
          {locked && (
            <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 p-6">
              <p className="text-3xl">🔐</p>
              {!address ? (
                <>
                  <p className="text-sm text-gray-400 max-w-sm">
                    Connect your wallet to begin a private session. Your session
                    key is derived from a wallet signature — the server can't
                    reconstruct your conversations without it.
                  </p>
                  <WalletButton />
                </>
              ) : (
                <>
                  <p className="text-sm text-gray-400 max-w-sm">
                    Sign the deterministic message{" "}
                    <code className="text-gray-300">
                      "Hermes Chatbot Session Key v1"
                    </code>{" "}
                    to derive your session key. Same wallet → same key → same
                    history.
                  </p>
                  <button
                    className="rounded-lg bg-hermes-600 px-5 py-2.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50"
                    onClick={unlock}
                    disabled={signing}
                  >
                    {signing ? "Waiting for signature…" : "Sign to unlock"}
                  </button>
                  {signError && (
                    <p className="text-xs text-red-400">{signError}</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* Messages */}
          {!locked && (
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <div className="flex flex-col items-center justify-center h-full text-center text-gray-600 gap-3">
                  <p className="text-3xl">🔐</p>
                  <p className="text-sm max-w-xs">
                    Send an encrypted message to the concierge. Every message is
                    sealed before leaving your browser.
                  </p>
                  <p className="text-xs text-gray-700">
                    Body is opaque on chain — toggle "what's on chain" to see.
                  </p>
                </div>
              )}
              {messages.map((msg) => {
                const isUser = msg.role === "user";
                return (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${isUser ? "flex-row-reverse" : ""}`}
                  >
                    {!isUser && <AgentAvatar slug={AGENT_SLUG} size={28} />}
                    <div
                      className={`max-w-[70%] flex flex-col gap-1 ${isUser ? "items-end" : "items-start"}`}
                    >
                      <div
                        className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                          isUser
                            ? "bg-hermes-700 text-white rounded-tr-sm"
                            : "bg-gray-800 text-gray-200 rounded-tl-sm"
                        }`}
                      >
                        {msg.text}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs text-gray-700">
                          {new Date(msg.ts).toLocaleTimeString()}
                        </span>
                        {msg.rootHash && (
                          <>
                            <span className="text-gray-800">·</span>
                            <button
                              className={`text-xs font-mono transition-colors ${showRaw === msg.id ? "text-hermes-300" : "text-gray-700 hover:text-gray-500"}`}
                              onClick={() =>
                                setShowRaw(showRaw === msg.id ? null : msg.id)
                              }
                            >
                              {showRaw === msg.id
                                ? "hide chain ↑"
                                : "what's on chain →"}
                            </button>
                          </>
                        )}
                      </div>
                      {showRaw === msg.id && (
                        <div className="w-full max-w-sm rounded-lg border border-gray-700 bg-gray-900 p-3 mt-1">
                          <p className="text-xs font-mono text-gray-500 mb-2">
                            raw envelope · body = sealed ciphertext
                          </p>
                          <RawEnvelopePanel msg={msg} />
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
              {sending && (
                <div className="flex gap-3">
                  <AgentAvatar slug={AGENT_SLUG} size={28} />
                  <div className="rounded-2xl rounded-tl-sm bg-gray-800 px-4 py-3 flex items-center gap-1.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:0ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:150ms]" />
                    <span className="h-1.5 w-1.5 rounded-full bg-gray-500 animate-bounce [animation-delay:300ms]" />
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </div>
          )}

          {/* Input */}
          {!locked && (
            <div className="flex-shrink-0 border-t border-gray-800 p-4">
              <div className="flex gap-3 items-end">
                <div className="flex-1 relative">
                  <textarea
                    ref={inputRef}
                    className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-sm text-gray-200 placeholder-gray-600 resize-none focus:border-hermes-600 focus:outline-none leading-relaxed"
                    rows={2}
                    placeholder="Type a message… (Enter to send)"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={onKeyDown}
                    disabled={sending}
                  />
                  <div className="absolute bottom-2 right-3 text-xs text-gray-700 flex items-center gap-1">
                    <span>🔐</span>
                    <span>encrypted</span>
                  </div>
                </div>
                <button
                  className="rounded-xl bg-hermes-600 px-4 py-3 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors h-[52px]"
                  onClick={send}
                  disabled={sending || !input.trim()}
                >
                  Send
                </button>
              </div>
              <p className="mt-2 text-xs text-gray-700">
                session key derived from your wallet sig · history stored locally
              </p>
            </div>
          )}
        </div>

        {/* Persona side panel */}
        {showPersona && agent?.persona && (
          <aside className="w-72 flex-shrink-0 border-l border-gray-800 overflow-y-auto p-4">
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-4">
              Persona
            </h2>
            <pre className="text-xs text-gray-300 font-sans whitespace-pre-wrap leading-relaxed">
              {agent.persona}
            </pre>
          </aside>
        )}
      </div>
    </div>
  );
}
