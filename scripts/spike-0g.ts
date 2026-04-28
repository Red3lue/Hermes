import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import "dotenv/config";

const RPC = process.env.ZEROG_RPC_URL!;
const INDEXER = process.env.ZEROG_INDEXER_URL!;
const PK = process.env.DEPLOYER_PRIVATE_KEY!;

async function main() {
  const provider = new ethers.JsonRpcProvider(RPC);
  const signer = new ethers.Wallet(PK, provider);
  const indexer = new Indexer(INDEXER);
  const payload = new TextEncoder().encode("hermes spike: " + Date.now());
  const memData = new MemData(payload);
  const [tx, upErr] = await indexer.upload(memData, RPC, signer as any);
  if (upErr) throw upErr;
  if (!("rootHash" in tx)) throw new Error("expected single rootHash");
  console.log("uploaded, rootHash:", tx.rootHash, "tx:", tx.txHash);

  const [blob, dlErr] = await indexer.downloadToBlob(tx.rootHash, {
    proof: true,
  });
  if (dlErr) throw dlErr;

  const downloaded = new Uint8Array(await blob.arrayBuffer());
  const equal =
    downloaded.length === payload.length &&
    downloaded.every((b, i) => b === payload[i]);
  if (!equal) throw new Error("round-trip mismatch");
  console.log("✓ round-trip OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
