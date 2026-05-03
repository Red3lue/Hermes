import { useState } from "react";
import {
  addMember,
  removeMember,
  resolveAgent,
  ZeroGStorage,
  type BiomeDoc,
} from "hermes-agents-sdk";
import { publicClient } from "@/lib/chainConfig";
import { useWallet } from "@/hooks/useWallet";
import type { KeyPair } from "hermes-agents-sdk";

// The browser can't safely use ZeroGStorage (needs a private key on the
// signer). For owner-side biome edits we still call the SDK's addMember /
// removeMember, but fed through a thin shim that uploads via the proxy
// instead. We construct a ZeroGStorage with a dummy key just so its
// `uploadBlob` call route into our overridden method works — addMember
// only calls `storage.uploadBlob` and `setBiomeRecords`, so a thin
// adapter is sufficient.

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

function makeProxyStorage(): ZeroGStorage {
  // Construct a stub that quacks like ZeroGStorage but routes uploads
  // through the deployer-paid proxy.
  const stub = {
    async uploadBlob(bytes: Uint8Array): Promise<`0x${string}`> {
      const r = await fetch(`${BASE}/blob`, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes as BodyInit,
      });
      if (!r.ok) throw new Error(`proxy upload → ${r.status}`);
      const j = (await r.json()) as { rootHash: `0x${string}` };
      return j.rootHash;
    },
    async downloadBlob(root: `0x${string}`): Promise<Uint8Array> {
      const r = await fetch(`${BASE}/blob/${root}`);
      if (!r.ok) throw new Error(`proxy download → ${r.status}`);
      const buf = await r.arrayBuffer();
      return new Uint8Array(buf);
    },
  };
  return stub as unknown as ZeroGStorage;
}

export function BiomeMembersPanel({
  biomeName,
  doc,
  isOwner,
  ownerEns,
  myKeys,
  onChange,
}: {
  biomeName: string;
  doc: BiomeDoc | null;
  isOwner: boolean;
  ownerEns?: string;
  myKeys: KeyPair | null;
  onChange?: () => void;
}) {
  const { walletClient } = useWallet();
  const [newMemberEns, setNewMemberEns] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!doc) return null;

  async function handleAdd() {
    const ens = newMemberEns.trim();
    if (!ens || !walletClient || !myKeys || !ownerEns) return;
    setBusy("adding");
    setError(null);
    try {
      const agent = await resolveAgent(ens, publicClient);
      await addMember(
        {
          publicClient,
          wallet: walletClient as never,
          storage: makeProxyStorage(),
          myEns: ownerEns,
          myKeys,
        },
        biomeName,
        { ens, pubkey: agent.pubkey },
      );
      setNewMemberEns("");
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function handleRemove(ens: string) {
    if (!walletClient || !myKeys || !ownerEns) return;
    if (!confirm(`Remove ${ens}? This rotates K and re-publishes the biome doc.`)) {
      return;
    }
    setBusy(`removing:${ens}`);
    setError(null);
    try {
      await removeMember(
        {
          publicClient,
          wallet: walletClient as never,
          storage: makeProxyStorage(),
          myEns: ownerEns,
          myKeys,
        },
        biomeName,
        ens,
      );
      onChange?.();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel-soft p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow">Members · {doc.members.length}</p>
        <span className="text-[10px] font-mono text-gray-500">
          v{doc.version}
        </span>
      </div>

      <div className="space-y-2">
        {doc.members.map((m) => (
          <div
            key={m.ens}
            className="flex items-center gap-2 rounded-md border border-hermes-700/20 bg-ink-950/60 p-2"
          >
            <div className="min-w-0 flex-1">
              <p className="text-xs font-mono text-gray-200 truncate">
                {m.ens}
              </p>
              <p className="text-[10px] font-mono text-gray-500 truncate">
                pubkey · {m.pubkey.slice(0, 24)}…
              </p>
            </div>
            {isOwner && m.ens !== ownerEns && (
              <button
                onClick={() => handleRemove(m.ens)}
                disabled={busy !== null}
                className="text-xs text-red-400 hover:text-red-300 disabled:opacity-50"
              >
                {busy === `removing:${m.ens}` ? "…" : "remove"}
              </button>
            )}
            {m.ens === ownerEns && (
              <span className="pill-mint">owner</span>
            )}
          </div>
        ))}
      </div>

      {isOwner && (
        <div className="mt-4 pt-3 border-t border-hermes-700/20">
          <p className="eyebrow mb-2">Add member</p>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-hermes-700/40 bg-ink-900/80 px-3 py-1.5 text-sm font-mono placeholder-gray-600 focus:border-hermes-400 focus:shadow-neon-cyan focus:outline-none transition-all"
              placeholder="<label>.users.hermes.eth"
              value={newMemberEns}
              onChange={(e) => setNewMemberEns(e.target.value)}
              disabled={busy !== null}
            />
            <button
              onClick={handleAdd}
              disabled={busy !== null || !newMemberEns.trim()}
              className="btn-neon !px-3 !py-1.5 !text-[11px]"
            >
              {busy === "adding" ? "Adding…" : "Add"}
            </button>
          </div>
          <p className="mt-2 text-[11px] font-mono text-gray-500">
            Resolves the candidate's <code className="text-hermes-300">hermes.pubkey</code>,
            wraps K for them, signs a new BiomeDoc (v{doc.version + 1}),
            uploads, and updates ENS. 1 wallet sig + 1 Sepolia tx.
          </p>
          {error && (
            <p className="mt-2 text-xs text-red-400 whitespace-pre-wrap">
              {error}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
