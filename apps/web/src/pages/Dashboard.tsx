import { Link } from "react-router-dom";
import { useWallet } from "@/hooks/useWallet";
import { useMyAgents } from "@/hooks/useMyAgents";
import { useMyBiomes } from "@/hooks/useMyBiomes";
import { AgentCard } from "@/components/AgentCard";
import { BiomeCard } from "@/components/BiomeCard";
import { WalletButton } from "@/components/WalletButton";
import { HermesShell } from "@/components/HermesShell";

export default function Dashboard() {
  const { address, isConnected } = useWallet();
  const { agents, loading: agentsLoading } = useMyAgents();
  const {
    owned: biomesOwned,
    all: biomesAll,
    loading: biomesLoading,
  } = useMyBiomes();

  return (
    <HermesShell crumbs={[{ label: "dashboard" }]}>
      {!isConnected ? (
        <div className="flex flex-col items-center justify-center min-h-[60vh] gap-5 text-center px-6">
          <p className="font-display text-3xl font-bold text-gray-100">
            Connect to see your agents and biomes
          </p>
          <p className="text-gray-400 max-w-md leading-relaxed">
            Your agents and biomes are discovered from ENS. Connect a wallet
            to load them.
          </p>
          <WalletButton />
        </div>
      ) : (
        <div className="mx-auto max-w-6xl px-6 py-12">
          <div className="mb-8">
            <p className="eyebrow mb-2">Dashboard</p>
            <h1 className="font-display text-3xl sm:text-4xl font-bold text-gray-100">
              <span className="text-gradient-neon">Your network.</span>
            </h1>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
            {/* Left: My Agents */}
            <div>
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-display text-lg uppercase tracking-[0.18em] text-gray-200">
                  My Agents{" "}
                  {agents.length > 0 && (
                    <span className="text-gray-500 text-sm normal-case tracking-normal">
                      · {agents.length}
                    </span>
                  )}
                </h2>
                <Link
                  to="/agents/new"
                  className="btn-ghost-neon !px-3 !py-1.5"
                >
                  + new agent
                </Link>
              </div>
              {agentsLoading && (
                <p className="text-xs font-mono text-gray-500">
                  Discovering agents…
                </p>
              )}
              {!agentsLoading && agents.length === 0 && (
                <div className="rounded-xl border border-dashed border-hermes-700/30 p-6 text-center text-gray-500 text-sm">
                  <p>
                    No agents yet. An agent is an ENS subname you own with
                    Hermes records set.
                  </p>
                  <Link
                    to="/agents/new"
                    className="mt-3 inline-block text-hermes-300 hover:text-hermes-200"
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
                <h2 className="font-display text-lg uppercase tracking-[0.18em] text-gray-200">
                  My Biomes{" "}
                  {biomesAll.length > 0 && (
                    <span className="text-gray-500 text-sm normal-case tracking-normal">
                      · {biomesAll.length}
                    </span>
                  )}
                </h2>
                <Link
                  to="/biomes/new"
                  className="btn-ghost-neon !px-3 !py-1.5 !text-flux-200 !border-flux-500/45 hover:!border-flux-400 hover:!text-flux-100"
                >
                  + new biome
                </Link>
              </div>
              {biomesLoading && (
                <p className="text-xs font-mono text-gray-500">
                  Discovering biomes…
                </p>
              )}
              {!biomesLoading && biomesAll.length === 0 && (
                <div className="rounded-xl border border-dashed border-flux-700/30 p-6 text-center text-gray-500 text-sm">
                  <p>No biomes yet.</p>
                  <Link
                    to="/biomes/new"
                    className="mt-3 inline-block text-flux-300 hover:text-flux-200"
                  >
                    Create your first biome →
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

          <div className="mt-12 panel-soft p-4 text-xs font-mono text-gray-500 text-center">
            connected ·{" "}
            <span className="text-hermes-200">{address}</span>
          </div>
        </div>
      )}
    </HermesShell>
  );
}
