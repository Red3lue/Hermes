import { Link } from "react-router-dom";
import { WalletButton } from "@/components/WalletButton";

export default function AgentNew() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link to="/dashboard" className="text-gray-400 text-sm hover:text-gray-200">
          dashboard
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 text-sm">new agent</span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>
      <div className="mx-auto max-w-lg px-6 py-16 text-center">
        <p className="text-gray-400">
          Agent registration — coming soon. Will mint an ENS subname, generate X25519 keypair, and
          write hermes.pubkey + hermes.inbox records in one multicall.
        </p>
      </div>
    </div>
  );
}
