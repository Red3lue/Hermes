import { useState, useEffect } from "react";
import { useParams, Link } from "react-router-dom";
import { api, type BiomeResolveResult } from "@/lib/api";
import { AgentAvatar } from "@/components/AgentAvatar";

function Field({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs font-mono text-gray-500 mb-1">{label}</p>
      <p className={`text-sm text-gray-200 break-all ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="text-xs font-mono text-gray-600 hover:text-gray-400 transition-colors"
      onClick={() => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? "copied ✓" : text.slice(0, 18) + "… ⧉"}
    </button>
  );
}

export default function BiomeViewerPage() {
  const { name: paramName } = useParams<{ name: string }>();
  const [inputName, setInputName] = useState(paramName ?? "");
  const [result, setResult] = useState<BiomeResolveResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-resolve if name comes from URL param
  useEffect(() => {
    if (paramName) resolve(paramName);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function resolve(name = inputName) {
    const target = name.trim();
    if (!target) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const data = await api.context.resolve(target);
      setResult(data);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  const doc = result?.doc;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-4">
        <div className="mx-auto max-w-4xl flex items-center gap-4">
          <Link to="/" className="font-mono font-bold text-hermes-400 text-lg">hermes</Link>
          <span className="text-gray-700">/</span>
          <Link to="/demos" className="text-gray-400 text-sm hover:text-gray-200">demos</Link>
          <span className="text-gray-700">/</span>
          <span className="text-gray-400 text-sm">biome-explorer</span>
        </div>
      </nav>

      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-1">Biome Explorer</h1>
        <p className="text-gray-500 text-sm mb-6">
          Resolves ENS text records → downloads biome doc from 0G → shows charter, members, and metadata.
        </p>

        <div className="flex gap-3 mb-8">
          <input
            className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-2.5 text-sm font-mono text-gray-200 placeholder-gray-600 focus:border-hermes-600 focus:outline-none"
            placeholder="biome ENS name (e.g. demo.hermes.eth)"
            value={inputName}
            onChange={(e) => setInputName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && resolve()}
          />
          <button
            className="rounded-lg bg-hermes-600 px-5 py-2.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
            onClick={() => resolve()}
            disabled={loading}
          >
            {loading ? "Resolving…" : "Resolve"}
          </button>
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-xl border border-red-800 bg-red-950/20 p-5 mb-6">
            <p className="text-sm font-semibold text-red-400 mb-1">Resolution failed</p>
            <p className="text-sm text-red-300 leading-relaxed">{error}</p>
          </div>
        )}

        {/* Loading skeleton */}
        {loading && (
          <div className="space-y-3 animate-pulse">
            {[80, 60, 90, 50].map((w) => (
              <div key={w} className={`h-4 rounded bg-gray-800 w-${w}`} style={{ width: `${w}%` }} />
            ))}
          </div>
        )}

        {/* Resolved biome doc */}
        {doc && result && (
          <div className="space-y-5">
            {/* Header card */}
            <div className="rounded-xl border border-hermes-800 bg-hermes-950/20 p-5">
              <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                  <h2 className="text-lg font-bold text-hermes-300">{doc.name}</h2>
                  <p className="text-sm text-gray-400 mt-0.5">{doc.goal}</p>
                </div>
                <div className="flex items-center gap-3 text-xs font-mono text-gray-500 flex-wrap">
                  <span className="rounded border border-gray-700 px-2 py-1">v{result.version}</span>
                  <span className="rounded border border-gray-700 px-2 py-1">
                    {doc.members.length} member{doc.members.length !== 1 ? "s" : ""}
                  </span>
                  <span className="rounded border border-gray-700 px-2 py-1">
                    {new Date(doc.createdAt * 1000).toLocaleDateString()}
                  </span>
                </div>
              </div>
            </div>

            {/* On-chain proof */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 space-y-3">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
                On-chain proof
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <p className="text-xs font-mono text-gray-500 mb-1">biome.root (ENS text record)</p>
                  <CopyButton text={result.root} />
                </div>
                <div>
                  <p className="text-xs font-mono text-gray-500 mb-1">biome.version</p>
                  <p className="text-sm font-mono text-gray-300">{result.version}</p>
                </div>
                <div>
                  <p className="text-xs font-mono text-gray-500 mb-1">owner</p>
                  <p className="text-sm font-mono text-gray-300">{doc.ownerEns}</p>
                </div>
                <div>
                  <p className="text-xs font-mono text-gray-500 mb-1">doc sig (EIP-191)</p>
                  <CopyButton text={doc.sig} />
                </div>
              </div>
            </div>

            {/* Members */}
            <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-4">
                Members ({doc.members.length})
              </h3>
              <div className="space-y-3">
                {doc.members.map((m) => (
                  <div key={m.ens} className="flex items-center gap-3">
                    <AgentAvatar slug={m.ens.split(".")[0]} size={28} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-mono text-gray-200">{m.ens}</p>
                      {m.pubkey && (
                        <p className="text-xs font-mono text-gray-600 truncate">
                          pubkey: {m.pubkey.slice(0, 20)}…
                        </p>
                      )}
                    </div>
                    {m.ens === doc.ownerEns && (
                      <span className="text-xs rounded border border-hermes-800 text-hermes-400 px-1.5 py-0.5">
                        owner
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Rules / charter */}
            {doc.rules && Object.keys(doc.rules).length > 0 && (
              <div className="rounded-xl border border-gray-800 bg-gray-900 p-5">
                <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
                  Charter / rules
                </h3>
                <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap leading-relaxed">
                  {JSON.stringify(doc.rules, null, 2)}
                </pre>
              </div>
            )}

            {/* Raw doc toggle */}
            <details className="rounded-xl border border-gray-800 bg-gray-900">
              <summary className="px-5 py-3 text-xs font-mono text-gray-500 cursor-pointer hover:text-gray-300 transition-colors">
                raw biome doc ▶
              </summary>
              <pre className="px-5 pb-5 text-xs font-mono text-gray-400 whitespace-pre-wrap break-all leading-relaxed">
                {JSON.stringify(doc, null, 2)}
              </pre>
            </details>
          </div>
        )}

        {!result && !error && !loading && (
          <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 text-center">
            <p className="text-gray-600 text-sm">
              Enter a biome ENS name and click Resolve.
            </p>
            <p className="text-gray-700 text-xs mt-2">
              Requires agents-server running with SEPOLIA_RPC_URL + ZEROG_INDEXER_URL set.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
