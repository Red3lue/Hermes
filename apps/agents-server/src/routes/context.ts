import { Router, type Router as ExpressRouter } from "express";
import { getStore } from "../quorum-store.js";
import { getDefaultContext } from "../registry.js";

export const contextRouter: ExpressRouter = Router();

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
  // rootHash would be set after 0G upload in a full implementation
  store.contextRootHash = `0x${Date.now().toString(16).padStart(64, "0")}`;

  res.json({
    ok: true,
    version: store.contextVersion,
    rootHash: store.contextRootHash,
  });
});
