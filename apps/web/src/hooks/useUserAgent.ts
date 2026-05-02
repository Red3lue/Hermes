import { useState, useEffect, useCallback } from "react";
import { setAgentRecords } from "@hermes/sdk";
import { useWallet } from "./useWallet";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";
import {
  deriveX25519FromWallet,
  loadIdentity,
  saveIdentity,
  type UserIdentity,
} from "@/lib/userIdentity";

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

type State = {
  status:
    | "disconnected"
    | "needs-sign"
    | "needs-register"
    | "needs-records"
    | "ready"
    | "error";
  identity: UserIdentity | null;
  error: string | null;
};

/**
 * First-connect flow for a user becoming a peer agent on Hermes:
 *  1. Sign deterministic msg → derive X25519 keypair (no wallet money spent).
 *  2. POST /register-user → server mints <label>.users.hermes.eth and
 *     transfers ownership to the user (server pays Sepolia gas, one-time).
 *  3. User signs ENS multicall via their own wallet to set
 *     addr/hermes.pubkey/hermes.inbox text records (user pays gas, one-time).
 *
 * After step 3, identity is cached in localStorage and the user can act as
 * a full peer (send sealed envelopes, receive replies).
 */
export function useUserAgent() {
  const { address, walletClient } = useWallet();
  const [state, setState] = useState<State>({
    status: "disconnected",
    identity: null,
    error: null,
  });
  const [busy, setBusy] = useState(false);

  // When wallet (re)connects, hydrate from localStorage
  useEffect(() => {
    if (!address) {
      setState({ status: "disconnected", identity: null, error: null });
      return;
    }
    const stored = loadIdentity(address);
    if (!stored) {
      setState({ status: "needs-sign", identity: null, error: null });
      return;
    }
    if (!stored.ens) {
      setState({
        status: "needs-register",
        identity: { ...stored, secretKey: "" } as UserIdentity,
        error: null,
      });
      return;
    }
    if (!stored.ensRecordsSet) {
      setState({
        status: "needs-records",
        identity: { ...stored, secretKey: "" } as UserIdentity,
        error: null,
      });
      return;
    }
    setState({
      status: "ready",
      identity: { ...stored, secretKey: "" } as UserIdentity,
      error: null,
    });
  }, [address]);

  /** Step 1: derive keypair from wallet sig. */
  const sign = useCallback(async () => {
    if (!walletClient || !address) return;
    setBusy(true);
    try {
      const { pubkey, secretKey } = await deriveX25519FromWallet(
        walletClient,
        address,
      );
      const identity: UserIdentity = {
        address,
        ens: "",
        pubkey,
        secretKey,
        ensRecordsSet: false,
      };
      saveIdentity({ ...identity, secretKey: "" } as never);
      setState({ status: "needs-register", identity, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: "error", error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }, [walletClient, address]);

  /** Step 2: server mints subname and transfers to user. */
  const register = useCallback(async () => {
    if (!address || !state.identity) return;
    setBusy(true);
    try {
      const r = await fetch(`${BASE}/register-user`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address }),
      });
      if (!r.ok) {
        const j = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `register-user → ${r.status}`);
      }
      const data = (await r.json()) as { ens: string; owner: string };
      const updated: UserIdentity = { ...state.identity, ens: data.ens };
      saveIdentity({ ...updated, secretKey: "" } as never);
      setState({ status: "needs-records", identity: updated, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: "error", error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }, [address, state.identity]);

  /** Step 3: user signs the multicall to set their own ENS text records. */
  const setRecords = useCallback(async () => {
    if (!walletClient || !address || !state.identity?.ens) return;
    setBusy(true);
    try {
      // Re-derive secret/pubkey if missing (page may have reloaded after step 1)
      let pubkey = state.identity.pubkey;
      if (!pubkey) {
        const k = await deriveX25519FromWallet(walletClient, address);
        pubkey = k.pubkey;
      }
      await setAgentRecords(
        state.identity.ens,
        {
          addr: address,
          pubkey,
          inbox: INBOX_CONTRACT,
        },
        publicClient,
        walletClient as never,
      );
      const updated: UserIdentity = {
        ...state.identity,
        pubkey,
        ensRecordsSet: true,
      };
      saveIdentity({ ...updated, secretKey: "" } as never);
      setState({ status: "ready", identity: updated, error: null });
    } catch (err) {
      setState((s) => ({ ...s, status: "error", error: (err as Error).message }));
    } finally {
      setBusy(false);
    }
  }, [walletClient, address, state.identity]);

  return { ...state, busy, sign, register, setRecords };
}
