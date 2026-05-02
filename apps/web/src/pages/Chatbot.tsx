import { Link } from "react-router-dom";
import { WalletButton } from "@/components/WalletButton";

export default function ChatbotPage() {
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
        <span className="text-gray-300 text-sm font-semibold">
          secret chatbot
        </span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>

      <div className="flex-1 flex flex-col items-center justify-center text-center gap-4 p-6">
        <p className="text-3xl">🚧</p>
        <h1 className="text-xl font-semibold">Chatbot — coming soon (on-chain)</h1>
        <p className="text-sm text-gray-400 max-w-lg leading-relaxed">
          The chatbot is being rewired to use the same on-chain message flow as
          the quorum: every message is sealed with the concierge's X25519
          pubkey, uploaded to 0G, and posted to <code>HermesInbox</code> on
          Sepolia. The concierge agent runtime polls its inbox, decrypts,
          replies via the same path back to your <code>users.hermes.eth</code>
          subname.
        </p>
        <p className="text-sm text-gray-500 max-w-lg leading-relaxed">
          Try the <Link to="/demos/quorum" className="text-hermes-400 hover:text-hermes-300">quorum demo</Link>{" "}
          — it already runs end-to-end on chain.
        </p>
      </div>
    </div>
  );
}
