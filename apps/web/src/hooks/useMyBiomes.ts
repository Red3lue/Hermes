import { useState, useEffect } from "react";
import { useWallet } from "./useWallet";
import {
  getOwnedBiomeSubnames,
  hasBracketHashSegment,
} from "@/lib/ensSubnames";
import { PARENT_ENS } from "@/lib/chainConfig";

// Legacy localStorage key from the removed "Join a BIOME by name" bookmark
// feature. Cleaned up on first load so old entries don't linger forever.
const LEGACY_JOINED_KEY = "hermes.joinedBiomes";

function clean(list: string[]): string[] {
  return list.filter((n) => !hasBracketHashSegment(n));
}

export function useMyBiomes() {
  const { address } = useWallet();
  const [owned, setOwned] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    // One-time cleanup of the legacy bookmark store.
    try {
      localStorage.removeItem(LEGACY_JOINED_KEY);
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    if (!address) {
      setOwned([]);
      return;
    }
    setLoading(true);
    getOwnedBiomeSubnames(address, PARENT_ENS)
      .then((list) => setOwned(clean(list)))
      .finally(() => setLoading(false));
  }, [address]);

  // `all` is preserved as an alias for `owned` so existing callers don't
  // break. The dashboard reads from `all`.
  return { owned, all: owned, loading };
}
