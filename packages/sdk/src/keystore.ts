import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { KeyPair } from "./crypto";

export type BiomeKeyEntry = {
  version: number;
  K: string; // base64
  fetchedAt: number;
};

export type Keystore = {
  ensName: string;
  address: `0x${string}`; // owning EOA — guard against keystore/wallet mismatch
  keyVersion: number; // for rotation
  x25519: KeyPair; // cache; can always be re-derived from wallet + version
  biomes?: Record<string, BiomeKeyEntry>; // keyed by biome ENS name
  // lastHistoryRoots key = `${peerOrBiome}|${thread ?? ""}` → 0G rootHash of the
  // most recent history manifest the local agent uploaded for that thread.
  lastHistoryRoots?: Record<string, `0x${string}`>;
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

export function saveBiomeKey(
  path: string,
  biomeName: string,
  entry: BiomeKeyEntry,
): void {
  const ks = loadKeystore(path);
  ks.biomes = { ...(ks.biomes ?? {}), [biomeName]: entry };
  saveKeystore(path, ks);
}

export function loadBiomeKey(
  path: string,
  biomeName: string,
): BiomeKeyEntry | null {
  const ks = tryLoadKeystore(path);
  return ks?.biomes?.[biomeName] ?? null;
}

export function historyKey(peerOrBiome: string, thread?: string): string {
  return `${peerOrBiome}|${thread ?? ""}`;
}

export function getLastHistoryRoot(
  path: string,
  key: string,
): `0x${string}` | null {
  const ks = tryLoadKeystore(path);
  return ks?.lastHistoryRoots?.[key] ?? null;
}

export function setLastHistoryRoot(
  path: string,
  key: string,
  root: `0x${string}`,
): void {
  const ks = loadKeystore(path);
  ks.lastHistoryRoots = { ...(ks.lastHistoryRoots ?? {}), [key]: root };
  saveKeystore(path, ks);
}
