import { keccak256, toBytes, type WalletClient } from "viem";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";

const { encodeBase64 } = naclUtil;

const SIGN_MESSAGE = "Hermes user identity v1";
const LS_KEY = (addr: string) => `hermes:user:${addr.toLowerCase()}`;

export type UserIdentity = {
  address: `0x${string}`;
  ens: string;                      // <label>.users.hermes.eth
  pubkey: string;                   // base64 X25519 pubkey
  secretKey: string;                // base64 X25519 secret (cached locally)
  ensRecordsSet: boolean;           // whether the user has set hermes.pubkey on chain
};

type StoredIdentity = Omit<UserIdentity, "secretKey"> & {
  // secretKey is rederived from sig each session for safety; not persisted
};

export function loadIdentity(address: string): StoredIdentity | null {
  try {
    const raw = localStorage.getItem(LS_KEY(address));
    return raw ? (JSON.parse(raw) as StoredIdentity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: StoredIdentity): void {
  localStorage.setItem(LS_KEY(id.address), JSON.stringify(id));
}

/**
 * Sign a deterministic message with the user's wallet, derive a 32-byte
 * seed via keccak256(signature), and turn that into a tweetnacl X25519
 * keypair. Same wallet → same keypair, every time.
 */
export async function deriveX25519FromWallet(
  wallet: WalletClient,
  address: `0x${string}`,
): Promise<{ pubkey: string; secretKey: string }> {
  const sig = await wallet.signMessage({
    account: address,
    message: SIGN_MESSAGE,
  });
  const seed = keccak256(toBytes(sig));
  const seedBytes = Buffer.from(seed.slice(2), "hex");
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  return {
    pubkey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}
