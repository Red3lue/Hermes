import { Indexer, MemData } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";

export type StorageConfig = {
  rpcUrl: string; // 0G chain RPC
  indexerUrl: string; // 0G indexer
  privateKey: string; // 0x-prefixed
};

export class ZeroGStorage {
  private indexer: Indexer;
  private signer: ethers.Wallet;
  private rpc: string;

  constructor(cfg: StorageConfig) {
    const provider = new ethers.JsonRpcProvider(cfg.rpcUrl);
    this.signer = new ethers.Wallet(cfg.privateKey, provider);
    this.indexer = new Indexer(cfg.indexerUrl);
    this.rpc = cfg.rpcUrl;
  }

  async uploadBlob(bytes: Uint8Array): Promise<`0x${string}`> {
    const memData = new MemData(bytes);
    const [tx, err] = await this.indexer.upload(
      memData,
      this.rpc,
      this.signer as any,
      undefined,
      undefined,
      { gasLimit: 1_000_000n },
    );
    if (err) throw err;
    if (!("rootHash" in tx)) throw new Error("upload returned no rootHash");
    return tx.rootHash as `0x${string}`;
  }

  async downloadBlob(rootHash: `0x${string}`): Promise<Uint8Array> {
    const [blob, err] = await this.indexer.downloadToBlob(rootHash, {
      proof: true,
    });
    if (err) throw err;
    return new Uint8Array(await blob.arrayBuffer());
  }
}
