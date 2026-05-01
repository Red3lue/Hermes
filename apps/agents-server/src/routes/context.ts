import { Router, type Router as ExpressRouter } from "express";
import { resolveBiomeRecords, ZeroGStorage } from "@hermes/sdk";
import { getPublicClient } from "../chain.js";
import { getStore } from "../quorum-store.js";
import { getDefaultContext } from "../registry.js";

export const contextRouter: ExpressRouter = Router();

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
  const { context } = req.body as { context?: string };
  if (typeof context !== "string" || !context.trim()) {
    res.status(400).json({ error: "context must be a non-empty string" });
    return;
  }

  const store = getStore(req.params.name);
  store.context = context.trim();
  store.contextVersion += 1;
  store.contextRootHash = `0x${Date.now().toString(16).padStart(64, "0")}`;

  res.json({
    ok: true,
    version: store.contextVersion,
    rootHash: store.contextRootHash,
  });
});
