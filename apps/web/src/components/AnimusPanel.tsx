import { useState, useEffect, useCallback } from "react";
import { peekAnimusFE, resolveAnimusFE, publishAnimus } from "@/lib/animaClient";
import { useWallet } from "@/hooks/useWallet";

type Peek = {
  root: `0x${string}`;
  ownerAddr: `0x${string}`;
  ownerEns: string;
  createdAt: number;
};

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "encrypted"; peek: Peek }
  | { kind: "decrypted"; peek: Peek; content: string }
  | { kind: "error"; message: string };

export function AnimusPanel({
  biomeName,
  ownerEns,
  K,
  isMember,
  isOwner,
}: {
  biomeName: string;
  ownerEns?: string;
  K: Uint8Array | null;
  isMember: boolean;
  isOwner: boolean;
}) {
  const { address, walletClient } = useWallet();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const r = await peekAnimusFE(biomeName);
      if (!r) {
        setState({ kind: "absent" });
        return;
      }
      setState({
        kind: "encrypted",
        peek: {
          root: r.root,
          ownerAddr: r.doc.ownerAddr,
          ownerEns: r.doc.ownerEns,
          createdAt: r.doc.createdAt,
        },
      });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [biomeName]);

  useEffect(() => {
    load();
  }, [load]);

  async function decrypt() {
    if (!K) {
      setDecryptError("biome key not available — join as member first");
      return;
    }
    setDecryptError(null);
    try {
      const r = await resolveAnimusFE(biomeName, K);
      if (!r) {
        setState({ kind: "absent" });
        return;
      }
      setState({
        kind: "decrypted",
        peek: {
          root: r.root,
          ownerAddr: r.doc.ownerAddr,
          ownerEns: r.doc.ownerEns,
          createdAt: r.doc.createdAt,
        },
        content: r.content,
      });
    } catch (err) {
      setDecryptError((err as Error).message);
    }
  }

  async function save() {
    if (!walletClient || !address || !K || !ownerEns) return;
    setBusy(true);
    setError(null);
    try {
      await publishAnimus({
        biomeName,
        ownerEns,
        ownerAddr: address,
        content: draft,
        K,
        walletClient,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="panel-neon-flux p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow text-flux-300">Animus — soul of the biome</p>
        {state.kind !== "loading" && state.kind !== "absent" && state.kind !== "error" && (
          <span className="text-[10px] font-mono text-gray-500 truncate max-w-[160px]">
            root · {state.peek.root.slice(0, 12)}…
          </span>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="text-xs font-mono text-gray-500">Resolving animus…</p>
      )}

      {state.kind === "error" && (
        <p className="text-xs text-red-400 whitespace-pre-wrap">
          {state.message}
        </p>
      )}

      {state.kind === "absent" && !editing && (
        <div>
          <p className="text-xs text-gray-600 mb-3">
            No animus published for this biome. The owner can publish a
            shared, encrypted soul that all members read before acting.
          </p>
          {isOwner && K && ownerEns && (
            <button
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              className="btn-neon !px-3 !py-1.5 !text-[11px]"
            >
              + Publish animus
            </button>
          )}
          {isOwner && !K && (
            <p className="text-[11px] text-gray-700">
              Decrypt the biome key first (join as member) before publishing.
            </p>
          )}
        </div>
      )}

      {state.kind === "encrypted" && !editing && (
        <>
          <div className="rounded-md border border-flux-700/40 bg-ink-950/80 p-3 font-mono text-xs text-flux-200/70 break-all">
            <span className="text-flux-400">[encrypted ciphertext —</span>{" "}
            only biome members can decrypt
            <span className="text-flux-400">]</span>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {isMember && K ? (
              <button
                onClick={decrypt}
                className="text-xs rounded-md bg-purple-700 px-3 py-1.5 hover:bg-purple-600 transition-colors flex items-center gap-1.5"
              >
                🔓 Decrypt
              </button>
            ) : (
              <span className="text-[11px] text-gray-600 italic">
                you don't hold a wrap for this biome
              </span>
            )}
            {decryptError && (
              <span className="text-xs text-red-400">{decryptError}</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-flux-900/40 flex items-center justify-between text-[11px] font-mono text-gray-600">
            <span>owner: {state.peek.ownerEns}</span>
            <span>
              published{" "}
              {new Date(state.peek.createdAt * 1000).toLocaleString()}
            </span>
          </div>
        </>
      )}

      {state.kind === "decrypted" && !editing && (
        <>
          <pre className="whitespace-pre-wrap text-sm text-gray-200 font-sans leading-relaxed max-h-64 overflow-y-auto">
            {state.content}
          </pre>
          <div className="mt-3 pt-3 border-t border-flux-900/40 flex items-center justify-between text-[11px] font-mono text-gray-600">
            <span>owner: {state.peek.ownerEns}</span>
            <span>
              published{" "}
              {new Date(state.peek.createdAt * 1000).toLocaleString()}
            </span>
          </div>
          {isOwner && K && ownerEns && (
            <button
              onClick={() => {
                setDraft(state.content);
                setEditing(true);
              }}
              className="mt-3 text-xs rounded-md border border-flux-700/40 px-3 py-1.5 hover:border-purple-700 transition-colors"
            >
              Edit animus
            </button>
          )}
        </>
      )}

      {editing && (
        <>
          <textarea
            className="w-full rounded-lg border border-flux-700/40 bg-ink-900/80 p-3 text-sm text-gray-200 font-mono resize-y focus:border-flux-400 focus:shadow-neon-flux focus:outline-none disabled:opacity-50 transition-all"
            rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Markdown — the biome's shared soul. Encrypted with K before upload."
            disabled={busy}
          />
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={busy || !draft.trim() || !K || !ownerEns}
              className="text-xs rounded-md bg-purple-700 px-3 py-1.5 font-semibold hover:bg-purple-600 disabled:opacity-50 transition-colors"
            >
              {busy ? "Encrypting & publishing…" : "Encrypt, sign & publish"}
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
            secretbox(content, K) · 1 wallet sig · 1 0G upload · 1 Sepolia tx.
            Rejects if you don't own this biome ENS.
          </p>
        </>
      )}
    </div>
  );
}
