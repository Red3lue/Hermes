import { useState, useEffect } from "react";
import { useWallet } from "./useWallet";
import { getOwnedSubnames, hasBracketHashSegment } from "@/lib/ensSubnames";
import { PARENT_ENS } from "@/lib/chainConfig";

function clean(list: string[]): string[] {
  return list.filter((n) => !hasBracketHashSegment(n));
}

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
      .then((list) => setAgents(clean(list)))
      .finally(() => setLoading(false));
  }, [address]);

  function refetch() {
    if (!address) return;
    getOwnedSubnames(address, PARENT_ENS).then((list) =>
      setAgents(clean(list)),
    );
  }

  return { agents, loading, refetch };
}
