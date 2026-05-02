import { useState, useEffect, useCallback } from "react";
import { publishAnima, resolveAnimaFE } from "@/lib/animaClient";
import { useWallet } from "@/hooks/useWallet";

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | {
      kind: "loaded";
      content: string;
      root: `0x${string}`;
      ownerAddr: `0x${string}`;
      createdAt: number;
    }
  | { kind: "error"; message: string };

export function AnimaPanel({ ens }: { ens: string }) {
  const { address, walletClient } = useWallet();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<{
    root: `0x${string}`;
    tx: `0x${string}`;
  } | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const r = await resolveAnimaFE(ens);
      if (!r) {
        setState({ kind: "absent" });
        return;
      }
      setState({
        kind: "loaded",
        content: r.doc.content,
        root: r.root,
        ownerAddr: r.doc.ownerAddr,
        createdAt: r.doc.createdAt,
      });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [ens]);

  useEffect(() => {
    load();
  }, [load]);

  const isOwner =
    state.kind === "loaded" &&
    !!address &&
    state.ownerAddr.toLowerCase() === address.toLowerCase();
  // For absent state, allow editing if wallet is connected — server can
  // verify ENS ownership at write time (the multicall will revert if not
  // owner).
  const canEdit = !!address && !!walletClient;

  async function save() {
    if (!walletClient || !address) return;
    setBusy(true);
    setError(null);
    setSaved(null);
    try {
      const r = await publishAnima({
        ens,
        ownerAddr: address,
        content: draft,
        walletClient,
      });
      setSaved(r);
      setEditing(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
          Anima — soul of the agent
        </h3>
        {state.kind === "loaded" && (
          <span className="text-[10px] font-mono text-gray-600 truncate max-w-[160px]">
            root: {state.root.slice(0, 12)}…
          </span>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="text-xs text-gray-600">Resolving anima…</p>
      )}

      {state.kind === "error" && (
        <p className="text-xs text-red-400 whitespace-pre-wrap">
          {state.message}
        </p>
      )}

      {state.kind === "absent" && !editing && (
        <div>
          <p className="text-xs text-gray-600 mb-3">
            No anima published for this agent. The owner can publish one to
            give the agent grounding context that ships with every reply.
          </p>
          {canEdit && (
            <button
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              className="text-xs rounded-md bg-hermes-600 px-3 py-1.5 hover:bg-hermes-500 transition-colors"
            >
              + Publish anima
            </button>
          )}
        </div>
      )}

      {state.kind === "loaded" && !editing && (
        <>
          <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed max-h-64 overflow-y-auto">
            {state.content}
          </pre>
          <div className="mt-3 pt-3 border-t border-gray-800 flex items-center justify-between text-[11px] font-mono text-gray-600">
            <span>
              owner: {state.ownerAddr.slice(0, 10)}…
              {state.ownerAddr.slice(-4)}
            </span>
            <span>
              published {new Date(state.createdAt * 1000).toLocaleString()}
            </span>
          </div>
          {isOwner && (
            <button
              onClick={() => {
                setDraft(state.content);
                setEditing(true);
              }}
              className="mt-3 text-xs rounded-md border border-gray-700 px-3 py-1.5 hover:border-gray-600 transition-colors"
            >
              Edit anima
            </button>
          )}
        </>
      )}

      {editing && (
        <>
          <textarea
            className="w-full rounded-lg border border-gray-700 bg-gray-950 p-3 text-sm text-gray-200 font-mono resize-y focus:border-hermes-600 focus:outline-none disabled:opacity-50"
            rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Markdown content the agent will load before answering…"
            disabled={busy}
          />
          <div className="mt-3 flex items-center gap-3">
            <button
              onClick={save}
              disabled={busy || !draft.trim()}
              className="text-xs rounded-md bg-hermes-600 px-3 py-1.5 font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
            >
              {busy ? "Signing & publishing…" : "Sign & publish"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
          <p className="mt-2 text-[11px] text-gray-700">
            1 wallet sig (over the doc) · 1 0G upload · 1 Sepolia tx
            (setText). Rejects if you don't own this ENS subname.
          </p>
        </>
      )}

      {saved && !editing && (
        <p className="mt-2 text-[11px] font-mono text-emerald-400">
          ✓ published · root {saved.root.slice(0, 12)}… ·{" "}
          <a
            href={`https://sepolia.etherscan.io/tx/${saved.tx}`}
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-emerald-300"
          >
            tx ↗
          </a>
        </p>
      )}
    </div>
  );
}
