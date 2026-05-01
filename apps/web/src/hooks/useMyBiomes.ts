import { useState, useEffect } from "react";
import { useWallet } from "./useWallet";
import { getOwnedBiomeSubnames } from "@/lib/ensSubnames";
import { PARENT_ENS } from "@/lib/chainConfig";

const STORAGE_KEY = "hermes.joinedBiomes";

export function useMyBiomes() {
  const { address } = useWallet();
  const [owned, setOwned] = useState<string[]>([]);
  const [joined, setJoined] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as string[];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setOwned([]);
      return;
    }
    setLoading(true);
    getOwnedBiomeSubnames(address, PARENT_ENS)
      .then(setOwned)
      .finally(() => setLoading(false));
  }, [address]);

  function addJoined(name: string) {
    setJoined((prev) => {
      if (prev.includes(name)) return prev;
      const next = [...prev, name];
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      return next;
    });
  }

  const all = [...new Set([...owned, ...joined])];
  return { owned, joined, all, loading, addJoined };
}
