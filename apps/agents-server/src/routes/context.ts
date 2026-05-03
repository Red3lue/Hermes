import { Router, type Router as ExpressRouter } from "express";
import { resolveBiomeRecords, ZeroGStorage } from "hermes-agents-sdk";
import { getPublicClient } from "../chain.js";

export const contextRouter: ExpressRouter = Router();

function getStorage() {
  return new ZeroGStorage({
    rpcUrl: process.env.ZEROG_RPC_URL!,
    indexerUrl: process.env.ZEROG_INDEXER_URL!,
    privateKey: (process.env.DEPLOYER_PRIVATE_KEY ??
      "0x" + "0".repeat(64)) as `0x${string}`,
  });
}

// Read-only convenience: resolve a biome by ENS name and pull the BiomeDoc
// from 0G. Used by the BiomeViewer / BiomeDetail pages to render charter
// metadata. Does NOT participate in the quorum message flow — that runs
// entirely on chain via user→coordinator DMs (HermesInbox + 0G).
contextRouter.get("/:name/resolve", async (req, res) => {
  const biomeName = decodeURIComponent(req.params.name);
  try {
    const publicClient = getPublicClient();
    const { root, version } = await resolveBiomeRecords(
      biomeName,
      publicClient,
    );

    const storage = getStorage();
    const bytes = await storage.downloadBlob(root);
    const text = new TextDecoder().decode(bytes);

    let doc: unknown;
    try {
      doc = JSON.parse(text);
    } catch {
      res.status(502).json({
        error: "biome doc is not valid JSON",
        raw: text.slice(0, 200),
      });
      return;
    }

    res.json({ root, version, doc });
  } catch (err) {
    const msg = (err as Error).message;
    if (msg.includes("Missing biome ENS records") || msg.includes("ENS")) {
      res.status(404).json({
        error: `No biome ENS records found for "${biomeName}". Check that biome.root and biome.version text records are set.`,
      });
    } else {
      res.status(500).json({ error: msg });
    }
  }
});
