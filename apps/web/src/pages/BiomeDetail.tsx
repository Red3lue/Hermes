import { useParams } from "react-router-dom";
import { useState, useEffect } from "react";
import { getEnsAddress, normalize } from "viem/ens";
import { unwrapKey } from "hermes-agents-sdk";
import { useBiome } from "@/hooks/useBiome";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { OnChainPanel } from "@/components/OnChainPanel";
import { AgentAvatar } from "@/components/AgentAvatar";
import { HermesShell } from "@/components/HermesShell";
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

  const rightSlot = (
    <>
      {loading && <span className="text-[11px] font-mono text-gray-500">loading…</span>}
      {isOwner && <span className="pill-mint">you own this biome</span>}
      {isMember && !isOwner && <span className="pill-cyan">member</span>}
    </>
  );

  return (
    <HermesShell
      full
      compact
      crumbs={[
        { label: "biomes", to: "/biomes" },
        { label: biomeName },
      ]}
      rightSlot={rightSlot}
    >
      <div className="flex flex-1 flex-col overflow-hidden">
      {error && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-red-900 bg-red-950/20 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Left: Charter + Roster (compact) */}
        <aside className="hidden lg:flex w-72 flex-shrink-0 flex-col border-r border-flux-700/20 overflow-y-auto p-4 gap-4 bg-ink-900/40">
          {doc ? (
            <>
              <div>
                <p className="eyebrow text-flux-300 mb-2">Charter</p>
                <p className="text-sm font-semibold text-gray-100">
                  {doc.goal}
                </p>
                {doc.rules && Object.keys(doc.rules).length > 0 && (
                  <pre className="mt-2 text-xs text-gray-500 whitespace-pre-wrap leading-relaxed">
                    {JSON.stringify(doc.rules, null, 2)}
                  </pre>
                )}
              </div>
              <div>
                <p className="eyebrow mb-2">Roster</p>
                <div className="space-y-2">
                  {members.map((m: { ens: string; pubkey: string }) => {
                    const slug = (m.ens ?? "").split(".")[0];
                    const known = Object.values(knownAgents).find(
                      (ka) => ka.ens === m.ens,
                    );
                    return (
                      <div key={m.ens} className="flex items-center gap-2">
                        <AgentAvatar slug={slug} size={22} />
                        <div className="min-w-0">
                          <p className="text-xs font-mono text-gray-300 truncate">
                            {m.ens}
                          </p>
                          {known?.displayName && (
                            <p className="text-[10px] text-gray-500">
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
                className="text-xs text-gray-500 hover:text-hermes-300 text-left transition-colors"
              >
                {showRawDoc ? "hide raw doc ▲" : "view charter source ▼"}
              </button>
              {showRawDoc && (
                <pre className="text-xs font-mono text-gray-500 whitespace-pre-wrap break-all leading-relaxed">
                  {JSON.stringify(doc, null, 2)}
                </pre>
              )}
            </>
          ) : loading ? (
            <div className="animate-pulse space-y-2">
              {[60, 80, 50].map((w) => (
                <div
                  key={w}
                  className="h-3 rounded bg-ink-800"
                  style={{ width: `${w}%` }}
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-gray-500">
              BiomeDoc not yet available. ENS biome.root may not be set.
            </p>
          )}
        </aside>

        {/* Center: Animus + Members + Transcript */}
        <main className="flex flex-1 flex-col min-w-0 border-r border-hermes-700/20 overflow-y-auto">
          {!isMember && doc && (
            <div className="flex-shrink-0 px-4 py-2 border-b border-hermes-700/20 text-xs text-gray-500 bg-ink-900/50">
              You can read public metadata, but you don't hold a wrap for
              this biome — ciphertext is opaque.
            </div>
          )}

          <div className="flex-shrink-0 p-4 space-y-4 border-b border-hermes-700/20">
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
            <p className="eyebrow">Inbox · {messages.length}</p>
            {messages.length === 0 && !loading && (
              <div className="flex flex-col items-center justify-center text-center text-gray-500 gap-3 py-12">
                <span className="text-flux-300 drop-shadow-[0_0_10px_rgba(196,84,255,0.4)]">
                  <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M12 2a5 5 0 015 5v3h.5A2.5 2.5 0 0120 12.5v6A2.5 2.5 0 0117.5 21h-11A2.5 2.5 0 014 18.5v-6A2.5 2.5 0 016.5 10H7V7a5 5 0 015-5zm0 2a3 3 0 00-3 3v3h6V7a3 3 0 00-3-3z" fill="currentColor" fillOpacity="0.18"/></svg>
                </span>
                <p className="text-sm">
                  No messages yet. The biome inbox is empty.
                </p>
              </div>
            )}
            {messages.map((msg) => (
              <div key={msg.transactionHash} className="flex gap-3">
                <AgentAvatar slug={msg.from.slice(0, 6)} size={30} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-xs font-mono text-gray-500">
                      {msg.from.slice(0, 10)}…
                    </span>
                    <span className="text-xs text-gray-600">
                      block {msg.blockNumber.toString()}
                    </span>
                  </div>
                  <div className="mt-1 panel-soft px-3 py-2 text-xs font-mono text-gray-400">
                    <span className="text-flux-300">ciphertext</span> · root ·{" "}
                    {msg.rootHash.slice(0, 18)}…
                  </div>
                </div>
              </div>
            ))}
          </div>
        </main>

        {/* Right: On-chain panel */}
        <aside className="hidden xl:flex w-72 flex-shrink-0 flex-col overflow-y-auto p-4 gap-4 bg-ink-900/40">
          <div>
            <p className="eyebrow mb-3">
              On-chain events · {messages.length}
            </p>
            <OnChainPanel messages={messages} />
          </div>
          {root && (
            <div className="mt-2">
              <p className="eyebrow mb-2">Storage</p>
              <div className="panel-soft p-2.5 text-xs font-mono text-gray-500">
                <p className="text-hermes-300">biome.root</p>
                <p className="text-gray-500 break-all mt-1">{root}</p>
              </div>
            </div>
          )}
        </aside>
      </div>
      </div>
    </HermesShell>
  );
}
