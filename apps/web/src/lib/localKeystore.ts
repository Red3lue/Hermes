import type { KeyPair } from "hermes-agents-sdk";

const DB_NAME = "hermes-keystore";
const STORE = "keypairs";

async function openDb(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error);
  });
}

export async function saveKeyPair(address: string, kp: KeyPair): Promise<void> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(kp, address.toLowerCase());
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function loadKeyPair(address: string): Promise<KeyPair | null> {
  const db = await openDb();
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(address.toLowerCase());
    req.onsuccess = () => res((req.result as KeyPair) ?? null);
    req.onerror = () => rej(req.error);
  });
}
