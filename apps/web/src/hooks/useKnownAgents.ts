import { useState, useEffect } from "react";

export type KnownAgent = {
  ens: string;
  role?: string;
  displayName?: string;
  tagline?: string;
  /** When present, this agent's X25519 keypair is derived via the SDK
   * `generateKeyPairFromSignature(wallet, version)` scheme (signs
   * "hermes-keygen-v<N>"). When absent, the agent was created via the
   * FE flow which signs `Hermes agent identity v1: <ens>` instead.
   * AnimaPanel checks this to use the right derivation when decrypting. */
  x25519Version?: number;
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
