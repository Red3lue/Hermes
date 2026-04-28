import { describe, it, expect } from "vitest";
import {
  generateKeyPair,
  encryptMessage,
  decryptMessage,
  signEIP191,
  verifyEIP191,
} from "../src/crypto";
import { createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

const TEST_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const account = privateKeyToAccount(TEST_PRIVATE_KEY);
const wallet = createWalletClient({
  account,
  chain: sepolia,
  transport: http(),
});

describe("generateKeyPair", () => {
  it("produces valid base64 keypair", () => {
    const kp = generateKeyPair();
    expect(kp.publicKey).toBeTruthy();
    expect(kp.secretKey).toBeTruthy();
    // base64 decodes to 32 bytes each
    expect(Buffer.from(kp.publicKey, "base64").length).toBe(32);
    expect(Buffer.from(kp.secretKey, "base64").length).toBe(32);
  });
});

describe("encryptMessage / decryptMessage", () => {
  it("round-trips plaintext", () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();
    const plaintext = "hello hermes";

    const { ciphertext, nonce } = encryptMessage(
      plaintext,
      recipient.publicKey,
      sender.secretKey,
    );

    const result = decryptMessage(
      ciphertext,
      nonce,
      sender.publicKey,
      recipient.secretKey,
    );

    expect(result).toBe(plaintext);
  });

  it("throws on tampered ciphertext", () => {
    const sender = generateKeyPair();
    const recipient = generateKeyPair();

    const { ciphertext, nonce } = encryptMessage(
      "secret",
      recipient.publicKey,
      sender.secretKey,
    );

    const tampered = Buffer.from(ciphertext, "base64");
    tampered[0] ^= 0xff;

    expect(() =>
      decryptMessage(
        tampered.toString("base64"),
        nonce,
        sender.publicKey,
        recipient.secretKey,
      ),
    ).toThrow("Decryption failed");
  });
});

describe("signEIP191 / verifyEIP191", () => {
  it("verifies a valid signature", async () => {
    const message = "canonical envelope payload";
    const sig = await signEIP191(wallet, message);
    const valid = await verifyEIP191(account.address, message, sig);
    expect(valid).toBe(true);
  });

  it("rejects signature over different message", async () => {
    const sig = await signEIP191(wallet, "original message");
    const valid = await verifyEIP191(account.address, "tampered message", sig);
    expect(valid).toBe(false);
  });
});
