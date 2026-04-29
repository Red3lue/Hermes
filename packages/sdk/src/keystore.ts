import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyPair } from "./crypto";

export type Keystore = {
  ensName: string;
  address: `0x${string}`; // owning EOA — guard against keystore/wallet mismatch
  keyVersion: number; // for rotation
  x25519: KeyPair; // cache; can always be re-derived from wallet + version
};

export function loadKeystore(path: string): Keystore {
  if (!existsSync(path)) throw new Error(`keystore not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf8")) as Keystore;
}

export function saveKeystore(path: string, ks: Keystore): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(path, JSON.stringify(ks, null, 2), { mode: 0o600 });
}

export function tryLoadKeystore(path: string): Keystore | null {
  return existsSync(path) ? loadKeystore(path) : null;
}
