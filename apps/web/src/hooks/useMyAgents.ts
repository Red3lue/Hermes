import { useState, useEffect } from "react";
import { useWallet } from "./useWallet";
import { getOwnedSubnames } from "@/lib/ensSubnames";
import { PARENT_ENS } from "@/lib/chainConfig";

export function useMyAgents() {
  const { address } = useWallet();
  const [agents, setAgents] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setAgents([]);
      return;
    }
    setLoading(true);
    getOwnedSubnames(address, PARENT_ENS)
      .then(setAgents)
      .finally(() => setLoading(false));
  }, [address]);

  function refetch() {
    if (!address) return;
    getOwnedSubnames(address, PARENT_ENS).then(setAgents);
  }

  return { agents, loading, refetch };
}
