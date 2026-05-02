import { Link } from "react-router-dom";
import { useMyBiomes } from "@/hooks/useMyBiomes";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { BiomeCard } from "@/components/BiomeCard";
import { WalletButton } from "@/components/WalletButton";

export default function BiomeList() {
  const { owned, all } = useMyBiomes();
  const knownAgents = useKnownAgents();
  const demoBiomeName =
    knownAgents["demoBiome"]?.ens ?? "quorumv2.biomes.hermes.eth";

  const discover = [...new Set([demoBiomeName, ...all])];

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-400 text-sm">biomes</span>
        <div className="ml-auto flex gap-3">
          <Link
            to="/biomes/new"
            className="text-sm text-hermes-400 hover:text-hermes-300 border border-hermes-800 rounded px-2 py-1"
          >
            + New BIOME
          </Link>
          <WalletButton />
        </div>
      </nav>
      <div className="mx-auto max-w-4xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-8">BIOMEs</h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {discover.map((name) => (
            <BiomeCard key={name} name={name} isOwner={owned.includes(name)} />
          ))}
        </div>
      </div>
    </div>
  );
}
