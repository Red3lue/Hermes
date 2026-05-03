import { useParams, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { getEnsAddress, normalize } from "viem/ens";
import { unwrapKey } from "hermes-agents-sdk";
import { useBiome } from "@/hooks/useBiome";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { OnChainPanel } from "@/components/OnChainPanel";
import { AgentAvatar } from "@/components/AgentAvatar";
import { WalletButton } from "@/components/WalletButton";
import { AnimusPanel } from "@/components/AnimusPanel";
import { BiomeMembersPanel } from "@/components/BiomeMembersPanel";
import { deriveX25519FromWallet } from "@/lib/userIdentity";
import { publicClient } from "@/lib/chainConfig";

type Keys = { pubkey: string; secretKey: string };

export default function BiomeDetail() {
  const { name } = useParams<{ name: string }>();
  const biomeName = name ? decodeURIComponent(name) : "";
  const { root, doc, messages, loading, error } = useBiome(
    biomeName || undefined,
  );
  const { address, walletClient } = useWallet();
  const user = useUserAgent();
  const knownAgents = useKnownAgents();

  const [showRawDoc, setShowRawDoc] = useState(false);
  const [myKeys, setMyKeys] = useState<Keys | null>(null);
  const [K, setK] = useState<Uint8Array | null>(null);
  const [ownerAddr, setOwnerAddr] = useState<`0x${string}` | null>(null);

  // Derive user X25519 keypair from wallet sig.
  useEffect(() => {
    if (user.status !== "ready" || !walletClient || !address) {
      setMyKeys(null);
      return;
    }
    let cancelled = false;
    deriveX25519FromWallet(walletClient, address)
      .then((kp) => !cancelled && setMyKeys(kp))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user.status, walletClient, address]);

  // Resolve the biome owner's wallet address (for isOwner check).
  useEffect(() => {
    if (!doc?.ownerEns) {
      setOwnerAddr(null);
      return;
    }
    let cancelled = false;
    getEnsAddress(publicClient, { name: normalize(doc.ownerEns) })
      .then((a) => !cancelled && setOwnerAddr(a as `0x${string}` | null))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [doc?.ownerEns]);

  // Try to unwrap K if the user holds a wrap.
  useEffect(() => {
    if (!doc || !myKeys || !user.identity?.ens) {
      setK(null);
      return;
    }
    const wrap = doc.wraps?.[user.identity.ens];
    if (!wrap) {
      setK(null);
      return;
    }
    try {
      const k = unwrapKey(wrap, doc.ownerPubkey, myKeys.secretKey);
      setK(k);
    } catch {
      setK(null);
    }
  }, [doc, myKeys, user.identity?.ens]);

  const myKeyPair = myKeys
    ? { publicKey: myKeys.pubkey, secretKey: myKeys.secretKey }
    : null;

  const members = doc?.members ?? [];
  const isMember = !!K;
  const isOwner =
    !!address &&
    !!ownerAddr &&
    address.toLowerCase() === ownerAddr.toLowerCase();

  // refresh handler — useBiome polls every 8s, but expose explicit hint.
  function refresh() {
    // The hook auto-refreshes on a timer; nothing manual to do for now.
  }

  return (
    <div className="flex h-screen flex-col bg-gray-950 text-gray-100 overflow-hidden">
      <nav className="flex-shrink-0 border-b border-gray-800 px-4 py-3 flex items-center gap-3">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link
          to="/biomes"
          className="text-gray-400 text-sm hover:text-gray-200"
        >
          biomes
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-mono truncate max-w-[200px]">
          {biomeName}
        </span>
        <div className="ml-auto flex items-center gap-3">
          {loading && <span className="text-xs text-gray-600">loading…</span>}
          {isOwner && (
            <span className="text-[10px] font-mono text-emerald-400 border border-emerald-700 rounded px-1.5 py-0.5">
              you own this biome
            </span>
          )}
          {isMember && !isOwner && (
            <span className="text-[10px] font-mono text-hermes-400 border border-hermes-700 rounded px-1.5 py-0.5">
              member
            </span>
          )}
          <WalletButton />
        </div>
      </nav>

      {error && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-red-900 bg-red-950/20 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Charter + Roster (compact) */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r border-gray-800 overflow-y-auto p-4 gap-4">
          {doc ? (
            <>
              <div>
                <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
                  Charter
                </h2>
                <p className="text-sm font-semibold text-gray-200">
                  {doc.goal}
                </p>
                {doc.rules && Object.keys(doc.rules).length > 0 && (
                  <pre className="mt-2 text-xs text-gray-600 whitespace-pre-wrap leading-relaxed">
                    {JSON.stringify(doc.rules, null, 2)}
                  </pre>
                )}
              </div>
              <div>
                <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
                  Roster
                </h2>
                <div className="space-y-2">
                  {members.map((m: { ens: string; pubkey: string }) => {
                    const slug = (m.ens ?? "").split(".")[0];
                    const known = Object.values(knownAgents).find(
                      (ka) => ka.ens === m.ens,
                    );
                    return (
                      <div key={m.ens} className="flex items-center gap-2">
                        <AgentAvatar slug={slug} size={20} />
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-gray-300 truncate">
                            {m.ens}
                          </p>
                          {known?.displayName && (
                            <p className="text-[10px] text-gray-600">
                              {known.displayName}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
              <button
                onClick={() => setShowRawDoc((v) => !v)}
                className="text-xs text-gray-600 hover:text-gray-400 text-left"
              >
                {showRawDoc ? "hide raw doc ▲" : "view charter source ▼"}
              </button>
              {showRawDoc && (
                <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(doc, null, 2)}
                </pre>
              )}
            </>
          ) : loading ? (
            <div className="animate-pulse space-y-2">
              {[60, 80, 50].map((w) => (
                <div
                  key={w}
                  className="h-3 rounded bg-gray-800"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-600">
              BiomeDoc not yet available. ENS biome.root may not be set.
            </p>
          )}
        </aside>

        {/* Center: Animus + Members + Transcript */}
        <main className="flex flex-1 flex-col min-w-0 border-r border-gray-800 overflow-y-auto">
          {!isMember && doc && (
            <div className="flex-shrink-0 px-4 py-2 border-b border-gray-800 text-xs text-gray-600 bg-gray-900/50">
              You can read public metadata, but you don't hold a wrap for
              this BIOME — ciphertext is opaque.
            </div>
          )}

          <div className="flex-shrink-0 p-4 space-y-4 border-b border-gray-800">
            <AnimusPanel
              biomeName={biomeName}
              ownerEns={doc?.ownerEns}
              K={K}
              isMember={isMember}
              isOwner={isOwner}
            />

            <BiomeMembersPanel
              biomeName={biomeName}
              doc={doc as never}
              isOwner={isOwner}
              ownerEns={doc?.ownerEns}
              myKeys={myKeyPair as never}
              onChange={refresh}
            />
          </div>

          {/* Transcript */}
          <div className="flex-1 px-4 py-4 space-y-3">
            <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500">
              Inbox ({messages.length})
            </h3>
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center text-center text-gray-600 gap-3 py-12">
                <p className="text-2xl">🔐</p>
                <p className="text-sm">
                  No messages yet. The biome inbox is empty.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.transactionHash} className="flex gap-3">
                <AgentAvatar slug={msg.from.slice(0, 6)} size={28} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono text-gray-600">
                      {msg.from.slice(0, 10)}…
                    </span>
                    <span className="text-xs text-gray-700">
                      block {msg.blockNumber.toString()}
                    </span>
                  </div>
                  <div className="mt-1 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2 text-xs font-mono text-gray-500">
                    <span className="text-gray-700">ciphertext</span> · root:{" "}
                    {msg.rootHash.slice(0, 18)}…
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Right: On-chain panel */}
        <aside className="hidden xl:flex w-72 flex-shrink-0 flex-col overflow-y-auto p-4 gap-4">
          <div>
            <h2 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-3">
              On-chain events ({messages.length})
            </h2>
            <OnChainPanel messages={messages} />
          </div>
          {root && (
            <div className="mt-2">
              <h3 className="text-xs font-mono font-semibold uppercase tracking-widest text-gray-500 mb-2">
                Storage
              </h3>
              <div className="rounded border border-gray-800 bg-gray-900 p-2 text-xs font-mono text-gray-600">
                <p>biome.root</p>
                <p className="text-gray-700 break-all mt-1">{root}</p>
              </div>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
