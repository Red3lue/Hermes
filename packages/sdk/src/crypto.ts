import nacl from "tweetnacl";
import * as util from "tweetnacl-util";
import { Hex, WalletClient, verifyMessage, keccak256 } from "viem";

export type KeyPair = {
  publicKey: string; // base64
  secretKey: string; // base64
};
export function generateKeyPair(): KeyPair {
  const kp = nacl.box.keyPair();
  return {
    publicKey: util.encodeBase64(kp.publicKey),
    secretKey: util.encodeBase64(kp.secretKey),
  };
}

// Fixed message so the same wallet always derives the same keypair.
const KEYGEN_MESSAGE = "hermes-keygen-v1"; //TODO: recheck this value before launch

export async function generateKeyPairFromSignature(
  wallet: WalletClient,
): Promise<KeyPair> {
  const sig = await wallet.signMessage({
    message: KEYGEN_MESSAGE,
    account: wallet.account!,
  });
  // keccak256 of the 65-byte sig → 32-byte deterministic seed
  const seed = keccak256(sig as `0x${string}`);
  const seedBytes = Buffer.from(seed.slice(2), "hex");
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  return {
    publicKey: util.encodeBase64(kp.publicKey),
    secretKey: util.encodeBase64(kp.secretKey),
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

  const recipientPublicKey = util.decodeBase64(recipientPublicKeyBase64);
  const senderSecretKey = util.decodeBase64(senderSecretKeyBase64);
  const messageBytes = util.decodeUTF8(message);

  const encrypted = nacl.box(
    messageBytes,
    nonce,
    recipientPublicKey,
    senderSecretKey,
  );

  return {
    nonce: util.encodeBase64(nonce),
    ciphertext: util.encodeBase64(encrypted),
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
  const ciphertext = util.decodeBase64(ciphertextBase64);
  const nonce = util.decodeBase64(nonceBase64);
  const senderPublicKey = util.decodeBase64(senderPublicKeyBase64);
  const recipientSecretKey = util.decodeBase64(recipientSecretKeyBase64);

  const decrypted = nacl.box.open(
    ciphertext,
    nonce,
    senderPublicKey,
    recipientSecretKey,
  );

  if (!decrypted) {
    throw new Error("Decryption failed");
  }

  return util.encodeUTF8(decrypted);
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
