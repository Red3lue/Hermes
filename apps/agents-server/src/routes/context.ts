import { Router, type Router as ExpressRouter } from "express";
import { resolveBiomeRecords, ZeroGStorage } from "@hermes/sdk";
import { getPublicClient } from "../chain.js";
import { loadAgents, getCoordinator, getQuorumAgents } from "../registry.js";
import { Hermes } from "@hermes/sdk";
import { makeWalletClient } from "../chain.js";
import { ensureAgentKeystore } from "../runtime/keystorePrep.js";
import { encodeBody } from "../quorum/envelopes.js";

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
// entirely on chain via the agent runtimes.
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

// Demo helper: accept a public submission and have the server (coordinator
// identity) dispatch it into the quorum flow. This allows demo users who
// aren't biome members to submit context via a trusted proxy.
contextRouter.post("/:name/submit-public", async (req, res) => {
  const biomeName = decodeURIComponent(req.params.name);
  const { markdown, fromEns } = req.body as {
    markdown?: string;
    fromEns?: string;
  };
  if (!markdown || typeof markdown !== "string") {
    res.status(400).json({ error: "missing markdown" });
    return;
  }

  try {
    // Find coordinator and members from registry
    loadAgents();
    const coordinator = getCoordinator();
    const members = getQuorumAgents();
    if (!coordinator)
      return res.status(500).json({ error: "no coordinator configured" });
    if (members.length === 0)
      return res.status(500).json({ error: "no quorum members configured" });

    // Ensure the coordinator keystore exists (idempotent)
    await ensureAgentKeystore(coordinator);

    // Create a Hermes instance for the coordinator agent (uses deployer wallet)
    const deployerKey = process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`;
    const hermes = new Hermes({
      ensName: coordinator.ens,
      inboxContract: process.env.HERMES_INBOX_CONTRACT! as `0x${string}`,
      publicClient: getPublicClient(),
      wallet: makeWalletClient(deployerKey),
      storage: {
        rpcUrl: process.env.ZEROG_RPC_URL!,
        indexerUrl: process.env.ZEROG_INDEXER_URL!,
        privateKey: deployerKey,
      },
      keystorePath: `.hermes-runtime/${coordinator.slug}.json`,
    });

    // Broadcast a started stage so FE timelines show activity
    const contextId = crypto.randomUUID();
    const started = {
      kind: "stage",
      stage: "started",
      contextId,
      meta: {
        requesterEns: fromEns ?? "public",
        members: members.map((m) => m.ens),
      },
    } as const;
    await hermes.sendToBiome(biomeName, encodeBody(started));

    // Fan out deliberate DM to each member
    const delib = {
      kind: "deliberate",
      contextId,
      contextMarkdown: markdown,
    } as const;
    for (const member of members) {
      try {
        await hermes.send(member.ens, encodeBody(delib));
      } catch (err) {
        console.warn(
          `[context:submit-public] dispatch to ${member.ens} failed:`,
          (err as Error).message,
        );
      }
    }

    res.json({ contextId });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
