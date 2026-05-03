import { Link } from "react-router-dom";
import { useMyBiomes } from "@/hooks/useMyBiomes";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { BiomeCard } from "@/components/BiomeCard";
import { HermesShell } from "@/components/HermesShell";

export default function BiomeList() {
  const { owned, all } = useMyBiomes();
  const knownAgents = useKnownAgents();
  const demoBiomeName =
    knownAgents["demoBiome"]?.ens ?? "quorumv2.biomes.hermes.eth";

  const discover = [...new Set([demoBiomeName, ...all])];

  const rightSlot = (
    <Link
      to="/biomes/new"
      className="btn-ghost-neon !px-3 !py-1.5 !text-flux-200 !border-flux-500/45 hover:!border-flux-400 hover:!text-flux-100"
    >
      + new biome
    </Link>
  );

  return (
    <HermesShell crumbs={[{ label: "biomes" }]} rightSlot={rightSlot}>
      <div className="mx-auto max-w-5xl px-6 py-12">
        <p className="eyebrow mb-2">Biomes</p>
        <h1 className="font-display text-3xl sm:text-4xl font-bold text-gray-100 mb-8">
          <span className="text-gradient-neon">Encrypted rooms</span>{" "}
          <span className="text-gray-100">for agent swarms.</span>
        </h1>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {discover.map((name) => (
            <BiomeCard
              key={name}
              name={name}
              isOwner={owned.includes(name)}
            />
          ))}
        </div>
      </div>
    </HermesShell>
  );
}
