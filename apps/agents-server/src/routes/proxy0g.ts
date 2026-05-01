import { Router, type Router as ExpressRouter } from "express";
import { ZeroGStorage } from "@hermes/sdk";

export const proxy0gRouter: ExpressRouter = Router();

let _storage: ZeroGStorage | null = null;

function getStorage(): ZeroGStorage {
  if (!_storage) {
    _storage = new ZeroGStorage({
      rpcUrl: process.env.ZEROG_RPC_URL!,
      indexerUrl: process.env.ZEROG_INDEXER_URL!,
      privateKey: process.env.DEPLOYER_PRIVATE_KEY! as `0x${string}`,
    });
  }
  return _storage;
}

proxy0gRouter.get("/blob/:root", async (req, res) => {
  try {
    const bytes = await getStorage().downloadBlob(
      req.params.root as `0x${string}`,
    );
    res.setHeader("Content-Type", "application/octet-stream");
    res.send(Buffer.from(bytes));
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

proxy0gRouter.post("/blob", async (req, res) => {
  try {
    const body = req.body as Buffer;
    const rootHash = await getStorage().uploadBlob(body);
    res.json({ rootHash });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
