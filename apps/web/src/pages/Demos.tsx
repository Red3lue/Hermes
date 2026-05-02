import { Link } from "react-router-dom";

const demos = [
  {
    to: "/demos/quorum",
    title: "Quorum",
    subtitle: "Ask the swarm · sealed DM · public access",
    desc: "Any registered .users.hermes.eth subdomain can submit a sealed request to the coordinator. Coordinator routes it to its 3-agent biome, collects verdicts, replies to you on chain. No HTTP — every leg is HermesInbox + 0G.",
    badge: "flagship",
  },
  {
    to: "/demos/chatbot",
    title: "Secret Chatbot",
    subtitle: "Encrypted 1:1 · ENS-addressed · body stays opaque on chain",
    desc: "Send an encrypted message to the concierge agent. The body is opaque ciphertext on chain. Toggle the chain view to see the envelope.",
    badge: null,
  },
  {
    to: "/biomes",
    title: "BIOME Explorer",
    subtitle: "Read any biome by ENS name",
    desc: "Open any biome, see its charter, member roster, and on-chain event log.",
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
          Live demos on Sepolia. All messages hit the chain. No backend — the browser talks to
          Sepolia + 0G directly.
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
              <span className="mt-2 text-sm font-medium text-hermes-400 group-hover:text-hermes-300">
                Open →
              </span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
