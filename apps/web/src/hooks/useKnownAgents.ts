import { useState, useEffect } from "react";

export type KnownAgent = {
  ens: string;
  role?: string;
  displayName?: string;
  tagline?: string;
};

export type KnownAgents = Record<string, KnownAgent>;

export function useKnownAgents() {
  const [agents, setAgents] = useState<KnownAgents>({});
  useEffect(() => {
    fetch("/known-agents.json")
      .then((r) => r.json())
      .then(setAgents)
      .catch(() => {});
  }, []);
  return agents;
}
