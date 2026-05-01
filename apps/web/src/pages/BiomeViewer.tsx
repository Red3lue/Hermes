import { useState } from "react";
import { useParams, Link } from "react-router-dom";

export default function BiomeViewerPage() {
  const { name: paramName } = useParams<{ name: string }>();
  const [inputName, setInputName] = useState(paramName ?? "");

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-5xl flex items-center gap-4">
          <Link to="/" className="font-mono font-bold text-hermes-400 text-lg">hermes</Link>
          <span className="text-gray-700">/</span>
          <Link to="/demos" className="text-gray-400 text-sm hover:text-gray-200">demos</Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-400 text-sm">biome-explorer</span>
        </div>
      </nav>

      <div className="mx-auto max-w-3xl px-6 py-16">
        <h1 className="text-2xl font-bold mb-2">Biome Explorer</h1>
        <p className="text-gray-400 text-sm mb-8">
          Resolve a biome by name. Shows charter, members, and opaque message log.
        </p>

        <div className="flex gap-3 mb-10">
          <input
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-hermes-600 focus:outline-none"
            placeholder="biome name (e.g. hermes-demo)"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
          />
          <button
            className="rounded-lg bg-hermes-600 px-4 py-2 text-sm font-semibold hover:bg-hermes-500 transition-colors"
            onClick={() => {}}
          >
            Resolve
          </button>
        </div>

        <div className="rounded-xl border border-gray-800 bg-gray-900 p-6 text-center text-gray-500 text-sm">
          Enter a biome name above to inspect its on-chain state.
          <br />
          <span className="text-xs text-gray-600 mt-2 block">
            Full viewer wired in F5 after the quorum backend is ready.
          </span>
        </div>
      </div>
    </div>
  );
}
