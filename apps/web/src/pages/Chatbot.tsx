import { Link } from "react-router-dom";

export default function ChatbotPage() {
  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center gap-4">
          <Link to="/" className="font-mono font-bold text-hermes-400 text-lg">hermes</Link>
          <span className="text-gray-700">/</span>
          <Link to="/demos" className="text-gray-400 text-sm hover:text-gray-200">demos</Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-400 text-sm">chatbot</span>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-12">
        <div className="rounded-xl border border-hermes-800 bg-hermes-950/20 p-8 text-center">
          <h1 className="text-2xl font-bold mb-2">Secret Chatbot</h1>
          <p className="text-gray-400 text-sm mb-4">
            Encrypted 1:1 chat with the concierge agent, addressed by ENS.
          </p>
          <p className="text-xs text-gray-600">
            Backend wired in F4 — agents-server must be running.
          </p>
        </div>
      </div>
    </div>
  );
}
