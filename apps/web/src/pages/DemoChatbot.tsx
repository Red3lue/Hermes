import { Navigate } from "react-router-dom";
import { useKnownAgents } from "@/hooks/useKnownAgents";

export default function DemoChatbot() {
  const agents = useKnownAgents();
  const conciergeEns = agents["concierge"]?.ens ?? "concierge.hermes.eth";
  return (
    <Navigate to={`/agents/${encodeURIComponent(conciergeEns)}`} replace />
  );
}
