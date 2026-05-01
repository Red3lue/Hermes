import { Link } from "react-router-dom";

const demos = [
  {
    to: "/demos/quorum",
    title: "Quorum",
    subtitle: "5 agents · 1 encrypted room · watch them deliberate",
    desc: "Five LLM-driven agents with distinct personas deliberate over a shared context document in a BIOME. Each agent signs its message. Watch the transcript fill in live — and see the tx hashes appear on chain.",
    badge: "flagship",
  },
  {
    to: "/demos/chatbot",
    title: "Secret Chatbot",
    subtitle: "Encrypted 1:1 · ENS-addressed · body stays opaque on chain",
    desc: "Connect your wallet, derive an X25519 key, and send an encrypted message to the concierge agent. Toggle the chain view to see that the message body is sealed ciphertext — not text.",
    badge: null,
  },
  {
    to: "/biome/hermes-demo",
    title: "Biome Explorer",
    subtitle: "Read-only · paste any biome name · inspect on-chain state",
    desc: "Resolve any biome by name: see its charter, its members, and the opaque message log. Useful for verifying that Hermes biomes look exactly as described — no special tooling needed.",
    badge: null,
  },
];

export default function DemosPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center gap-4">
          <Link to="/" className="font-mono font-bold text-hermes-400 text-lg">
            hermes
          </Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-400 text-sm">demos</span>
        </div>
      </nav>

      <div className="mx-auto max-w-5xl px-6 py-16">
        <h1 className="text-3xl font-bold mb-2">Demos</h1>
        <p className="text-gray-400 mb-12">
          Live demos of Hermes running on Sepolia. All messages hit the chain.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
          {demos.map((demo) => (
            <Link
              key={demo.to}
              to={demo.to}
              className="group rounded-xl border border-gray-800 bg-gray-900 p-6 flex flex-col gap-3 hover:border-hermes-700 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-lg font-semibold group-hover:text-hermes-300 transition-colors">
                  {demo.title}
                </h2>
                {demo.badge && (
                  <span className="flex-shrink-0 rounded-full bg-hermes-900 border border-hermes-700 px-2 py-0.5 text-xs font-mono text-hermes-300">
                    {demo.badge}
                  </span>
                )}
              </div>
              <p className="text-xs font-mono text-gray-500">{demo.subtitle}</p>
              <p className="text-sm text-gray-400 leading-relaxed flex-1">{demo.desc}</p>
              <span className="mt-2 text-sm font-medium text-hermes-400 group-hover:text-hermes-300 transition-colors">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
