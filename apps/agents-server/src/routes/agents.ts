import { Router, type Router as ExpressRouter } from "express";
import { loadAgents, getAgent } from "../registry.js";

export const agentsRouter: ExpressRouter = Router();

agentsRouter.get("/", (_req, res) => {
  const agents = loadAgents().map(({ slug, ens, address, roles, x25519PubKey }) => ({
    slug,
    ens,
    address,
    roles,
    x25519PubKey,
  }));
  res.json(agents);
});

agentsRouter.get("/:slug", (req, res) => {
  const agent = getAgent(req.params.slug);
  if (!agent) {
    res.status(404).json({ error: "agent not found" });
    return;
  }
  const { slug, ens, address, roles, x25519PubKey, persona } = agent;
  res.json({ slug, ens, address, roles, x25519PubKey, persona });
});
