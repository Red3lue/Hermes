import { Link } from "react-router-dom";
import { useState } from "react";
import { useWallet } from "@/hooks/useWallet";
import { useMyAgents } from "@/hooks/useMyAgents";
import { useMyBiomes } from "@/hooks/useMyBiomes";
import { AgentCard } from "@/components/AgentCard";
import { BiomeCard } from "@/components/BiomeCard";
import { WalletButton } from "@/components/WalletButton";

export default function Dashboard() {
  const { address, isConnected } = useWallet();
  const { agents, loading: agentsLoading } = useMyAgents();
  const {
    owned: biomesOwned,
    all: biomesAll,
    loading: biomesLoading,
    addJoined,
  } = useMyBiomes();
  const [joinInput, setJoinInput] = useState("");
  const [showJoin, setShowJoin] = useState(false);

  function handleJoin() {
    const name = joinInput.trim();
    if (!name) return;
    addJoined(name);
    setJoinInput("");
    setShowJoin(false);
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      {/* Nav */}
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 text-sm">dashboard</span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>

      {!isConnected ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4 text-center px-6">
          <p className="text-2xl font-bold">
            Connect to see your agents and BIOMEs
          </p>
          <p className="text-gray-500 max-w-sm">
            Your agents and BIOMEs are discovered from ENS. Connect a wallet to
            load them.
          </p>
          <WalletButton />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-6 py-10">
          {/* two-column grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: My Agents */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg">
                  My Agents{" "}
                  {agents.length > 0 && (
                    <span className="text-gray-500 text-sm">
                      ({agents.length})
                    </span>
                  )}
                </h2>
                <Link
                  to="/agents/new"
                  className="text-sm text-hermes-400 hover:text-hermes-300 border border-hermes-800 rounded px-2 py-1"
                >
                  + New agent
                </Link>
              </div>
              {agentsLoading && (
                <p className="text-xs text-gray-600">Discovering agents…</p>
              )}
              {!agentsLoading && agents.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-800 p-6 text-center text-gray-600 text-sm">
                  <p>
                    No agents yet. An agent is an ENS subname you own with
                    Hermes records set.
                  </p>
                  <Link
                    to="/agents/new"
                    className="mt-3 inline-block text-hermes-400 hover:text-hermes-300"
                  >
                    Register your first agent →
                  </Link>
                </div>
              )}
              <div className="space-y-3">
                {agents.map((ens) => (
                  <AgentCard key={ens} ens={ens} />
                ))}
              </div>
            </div>

            {/* Right: My BIOMEs */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-lg">
                  My BIOMEs{" "}
                  {biomesAll.length > 0 && (
                    <span className="text-gray-500 text-sm">
                      ({biomesAll.length})
                    </span>
                  )}
                </h2>
                <Link
                  to="/biomes/new"
                  className="text-sm text-hermes-400 hover:text-hermes-300 border border-hermes-800 rounded px-2 py-1"
                >
                  + New BIOME
                </Link>
              </div>
              <div className="mb-3">
                {showJoin ? (
                  <div className="flex gap-2">
                    <input
                      className="flex-1 rounded-lg border border-gray-700 bg-gray-900 px-3 py-2 text-sm font-mono placeholder-gray-600 focus:border-hermes-600 focus:outline-none"
                      placeholder="quorum.biomes.hermes.eth"
                      value={joinInput}
                      onChange={(e) => setJoinInput(e.target.value)}
                      onKeyDown={(e) => e.key === "Enter" && handleJoin()}
                    />
                    <button
                      onClick={handleJoin}
                      className="rounded-lg bg-hermes-600 px-3 py-2 text-sm hover:bg-hermes-500"
                    >
                      Join
                    </button>
                    <button
                      onClick={() => setShowJoin(false)}
                      className="text-xs text-gray-600 hover:text-gray-400"
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowJoin(true)}
                    className="text-xs text-hermes-400 hover:text-hermes-300"
                  >
                    + Join a BIOME by name
                  </button>
                )}
              </div>
              {biomesLoading && (
                <p className="text-xs text-gray-600">Discovering BIOMEs…</p>
              )}
              {!biomesLoading && biomesAll.length === 0 && (
                <div className="rounded-xl border border-dashed border-gray-800 p-6 text-center text-gray-600 text-sm">
                  <p>No BIOMEs yet.</p>
                  <Link
                    to="/biomes/new"
                    className="mt-3 inline-block text-hermes-400 hover:text-hermes-300"
                  >
                    Create your first BIOME →
                  </Link>
                </div>
              )}
              <div className="space-y-3">
                {biomesAll.map((name) => (
                  <BiomeCard
                    key={name}
                    name={name}
                    isOwner={biomesOwned.includes(name)}
                  />
                ))}
              </div>
            </div>
          </div>

          {/* Footer stats */}
          <div className="mt-10 rounded-xl border border-gray-800 bg-gray-900 p-4 text-xs text-gray-500 text-center">
            Connected:{" "}
            <span className="font-mono text-gray-400">{address}</span>
          </div>
        </div>
      )}
    </div>
  );
}
