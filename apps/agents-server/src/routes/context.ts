import { Router, type Router as ExpressRouter } from "express";
import { resolveBiomeRecords, ZeroGStorage } from "@hermes/sdk";
import { verifyMessage, namehash, getAddress } from "viem";
import { normalize } from "viem/ens";
import { getPublicClient } from "../chain.js";
import { getStore } from "../quorum-store.js";
import { getDefaultContext } from "../registry.js";

export const contextRouter: ExpressRouter = Router();

const ENS_REGISTRY = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e" as const;
const NAME_WRAPPER = "0x0635513f179D50A207757E05759CbD106d7dFcE8" as const;
const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;
const WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

async function getEnsOwner(name: string): Promise<`0x${string}`> {
  const client = getPublicClient();
  const node = namehash(normalize(name));
  const registryOwner = (await client.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as `0x${string}`;
  if (registryOwner.toLowerCase() === NAME_WRAPPER.toLowerCase()) {
    return (await client.readContract({
      address: NAME_WRAPPER,
      abi: WRAPPER_ABI,
      functionName: "ownerOf",
      args: [BigInt(node)],
    })) as `0x${string}`;
  }
  return registryOwner;
}

const AUTH_FRESHNESS_MS = 5 * 60 * 1000;
function buildAuthMessage(biomeName: string, ts: number, context: string): string {
  return [
    "Hermes biome context update v1",
    `biome: ${biomeName}`,
    `ts: ${ts}`,
    "---",
    context,
  ].join("\n");
}

function getStorage() {
  return new ZeroGStorage({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    indexerUrl: process.env.ZEROG_INDEXER_URL!,
    privateKey: (process.env.DEPLOYER_PRIVATE_KEY ?? "0x" + "0".repeat(64)) as `0x${string}`,
  });
}

// Resolve a real on-chain biome by ENS name
contextRouter.get("/:name/resolve", async (req, res) => {
  const biomeName = decodeURIComponent(req.params.name);
  try {
    const publicClient = getPublicClient();
    const { root, version } = await resolveBiomeRecords(biomeName, publicClient);

    const storage = getStorage();
    const bytes = await storage.downloadBlob(root);
    const text = new TextDecoder().decode(bytes);

    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      res.status(502).json({ error: "biome doc is not valid JSON", raw: text.slice(0, 200) });
      return;
    }

    res.json({ root, version, doc });
  } catch (err) {
    const msg = (err as Error).message;
    // Give a clear error if ENS records are missing vs other failures
    if (msg.includes("Missing biome ENS records") || msg.includes("ENS")) {
      res.status(404).json({ error: `No biome ENS records found for "${biomeName}". Check that biome.root and biome.version text records are set.` });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});

// In-memory context for the quorum demo
contextRouter.get("/:name/context", (req, res) => {
  const store = getStore(req.params.name);
  res.json({
    context: store.context || getDefaultContext(),
    version: store.contextVersion,
    rootHash: store.contextRootHash,
  });
});

contextRouter.post("/:name/context", async (req, res) => {
  const biomeName = req.params.name;
  const { context, auth } = req.body as {
    context?: string;
    auth?: { address?: string; signature?: string; ts?: number };
  };
  if (typeof context !== "string" || !context.trim()) {
    res.status(400).json({ error: "context must be a non-empty string" });
    return;
  }
  if (
    !auth ||
    typeof auth.address !== "string" ||
    typeof auth.signature !== "string" ||
    typeof auth.ts !== "number"
  ) {
    res.status(401).json({ error: "missing auth { address, signature, ts }" });
    return;
  }
  if (Math.abs(Date.now() - auth.ts) > AUTH_FRESHNESS_MS) {
    res.status(401).json({ error: "auth timestamp expired" });
    return;
  }

  const trimmed = context.trim();
  const message = buildAuthMessage(biomeName, auth.ts, trimmed);

  let valid = false;
  try {
    valid = await verifyMessage({
      address: auth.address as `0x${string}`,
      message,
      signature: auth.signature as `0x${string}`,
    });
  } catch (err) {
    res.status(401).json({ error: `signature verify failed: ${(err as Error).message}` });
    return;
  }
  if (!valid) {
    res.status(401).json({ error: "invalid signature" });
    return;
  }

  let owner: `0x${string}`;
  try {
    owner = await getEnsOwner(biomeName);
  } catch (err) {
    res.status(502).json({ error: `ENS owner lookup failed: ${(err as Error).message}` });
    return;
  }
  if (getAddress(owner) !== getAddress(auth.address as `0x${string}`)) {
    res.status(403).json({
      error: `signer ${auth.address} is not the ENS owner of ${biomeName} (${owner})`,
    });
    return;
  }

  const store = getStore(biomeName);
  store.context = trimmed;
  store.contextVersion += 1;
  store.contextRootHash = `0x${Date.now().toString(16).padStart(64, "0")}`;

  res.json({
    ok: true,
    version: store.contextVersion,
    rootHash: store.contextRootHash,
  });
});
