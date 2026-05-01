import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { AgentAvatar } from "@/components/AgentAvatar";
import { api, type AgentInfo, type ChatMessage } from "@/lib/api";

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
  const [agent, setAgent] = useState<AgentInfo | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [showRaw, setShowRaw] = useState<string | null>(null);
  const [showPersona, setShowPersona] = useState(false);
  const [sessionId] = useState(() => Math.random().toString(36).slice(2));
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.agents
      .get(AGENT_SLUG)
      .then(setAgent)
      .catch(() => {});
    api.chatbot
      .getLog(AGENT_SLUG, sessionId)
      .then(setMessages)
      .catch(() => {});
  }, [sessionId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function send() {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    try {
      const result = await api.chatbot.sendMessage(AGENT_SLUG, text, sessionId);
      setMessages((prev) => [...prev, result.userMessage, result.agentMessage]);
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
        </div>
      </nav>

      <div className="flex flex-1 overflow-hidden">
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

          {/* Messages */}
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

          {/* Input */}
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
              1 tx + 1 blob per message · body stays opaque on chain
            </p>
          </div>
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
