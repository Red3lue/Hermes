import { keccak256, toHex, toBytes } from "viem";
import type { WalletClient } from "viem";

const SIGN_MESSAGE = "Hermes Chatbot Session Key v1";
const SS_KEY = (addr: string) => `hermes:sessionkey:${addr.toLowerCase()}`;

export type SessionKey = {
  address: `0x${string}`;
  // 0x-prefixed 32-byte hex; deterministic per (wallet, SIGN_MESSAGE)
  key: `0x${string}`;
};

// Sign deterministic message and derive a 32-byte key. Cached for the tab
// session so the wallet only prompts once per page load.
export async function deriveSessionKey(
  wallet: WalletClient,
  address: `0x${string}`,
): Promise<SessionKey> {
  const cached = sessionStorage.getItem(SS_KEY(address));
  if (cached) return { address, key: cached as `0x${string}` };

  const sig = await wallet.signMessage({
    account: address,
    message: SIGN_MESSAGE,
  });
  const key = keccak256(toBytes(sig));
  sessionStorage.setItem(SS_KEY(address), key);
  return { address, key };
}

// Stable session id from the session key + a per-session salt.
export function newSessionId(sk: SessionKey): string {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(8)));
  return keccak256(toBytes(sk.key + salt.slice(2))).slice(2, 26);
}
