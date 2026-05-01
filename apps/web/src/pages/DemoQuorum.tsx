import { Navigate } from "react-router-dom";
import { useKnownAgents } from "@/hooks/useKnownAgents";

export default function DemoQuorum() {
  const agents = useKnownAgents();
  const biomeName = agents["demoBiome"]?.ens ?? "quorum.biomes.hermes.eth";
  return <Navigate to={`/biomes/${encodeURIComponent(biomeName)}`} replace />;
}
