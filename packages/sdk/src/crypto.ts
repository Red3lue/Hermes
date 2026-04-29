import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { Hex, WalletClient, verifyMessage, keccak256 } from "viem";

const { encodeBase64, decodeBase64, decodeUTF8, encodeUTF8 } = naclUtil;

export type KeyPair = {
  publicKey: string; // base64
  secretKey: string; // base64
};
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

// Versioned message → bump version to rotate keys without changing wallet.
export function keygenMessage(version: number = 1): string {
  return `hermes-keygen-v${version}`;
}

export async function generateKeyPairFromSignature(
  wallet: WalletClient,
  version: number = 1,
): Promise<KeyPair> {
  const sig = await wallet.signMessage({
    message: keygenMessage(version),
    account: wallet.account!,
  });
  // keccak256 of the 65-byte sig → 32-byte deterministic seed
  const seed = keccak256(sig as `0x${string}`);
  const seedBytes = Buffer.from(seed.slice(2), "hex");
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  return {
    publicKey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}
/**
 * Encrypt message using sender secret key + recipient public key
 */
export function encryptMessage(
  message: string,
  recipientPublicKeyBase64: string,
  senderSecretKeyBase64: string,
) {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);

  const recipientPublicKey = decodeBase64(recipientPublicKeyBase64);
  const senderSecretKey = decodeBase64(senderSecretKeyBase64);
  const messageBytes = decodeUTF8(message);

  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderSecretKey,
  );

  return {
    nonce: encodeBase64(nonce),
    ciphertext: encodeBase64(encrypted),
  };
}

/**
 * Decrypt message using sender public key + recipient secret key
 */
export function decryptMessage(
  ciphertextBase64: string,
  nonceBase64: string,
  senderPublicKeyBase64: string,
  recipientSecretKeyBase64: string,
): string {
  const ciphertext = decodeBase64(ciphertextBase64);
  const nonce = decodeBase64(nonceBase64);
  const senderPublicKey = decodeBase64(senderPublicKeyBase64);
  const recipientSecretKey = decodeBase64(recipientSecretKeyBase64);

  const decrypted = nacl.box.open(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientSecretKey,
  );

  if (!decrypted) {
    throw new Error("Decryption failed");
  }

  return encodeUTF8(decrypted);
}

/**
 * Sign a message with Ethereum wallet
 */
export async function signEIP191(
  walletClient: WalletClient,
  message: string,
): Promise<Hex> {
  return walletClient.signMessage({
    message,
    account: walletClient.account!,
  });
}

/**
 * Verify Ethereum signature
 */
export async function verifyEIP191(
  address: `0x${string}`,
  message: string,
  signature: Hex,
): Promise<boolean> {
  return verifyMessage({
    address,
    message,
    signature,
  });
}
