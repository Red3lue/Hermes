import { Indexer, MemData, StorageNode } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { ZEROG_RPC, ZEROG_INDEXER } from "./chainConfig";

const DEFAULT_CHUNK_SIZE = 256;
const DEFAULT_SEGMENT_MAX_CHUNKS = 1024;

function getSplitNum(total: number, unit: number): number {
  return Math.floor((total - 1) / unit + 1);
}

export async function uploadBlob(
  bytes: Uint8Array,
  eip1193Provider: unknown,
): Promise<`0x${string}`> {
  const ethersProvider = new ethers.BrowserProvider(eip1193Provider as ethers.Eip1193Provider);
  const signer = await ethersProvider.getSigner();
  const memData = new MemData(bytes);
  const indexer = new Indexer(ZEROG_INDEXER);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tx, err] = await indexer.upload(memData, ZEROG_RPC, signer as any);
  if (err) throw new Error(`0G upload failed: ${err}`);
  if (!("rootHash" in tx)) throw new Error("upload returned no rootHash");
  return tx.rootHash as `0x${string}`;
}

export async function downloadBlob(rootHash: `0x${string}`): Promise<Uint8Array> {
  const indexer = new Indexer(ZEROG_INDEXER);
  const locations = await indexer.getFileLocations(rootHash);
  if (!locations || locations.length === 0) throw new Error("File not found");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: StorageNode[] = (locations as any[]).map((loc) => new StorageNode(loc.url));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let fileInfo: any = null;
  for (const node of nodes) {
    try {
      const info = await node.getFileInfo(rootHash, true);
      if (info) {
        fileInfo = info;
        break;
      }
    } catch {
      continue;
    }
  }
  if (!fileInfo) throw new Error("Could not get file info");

  const fileSize = Number(fileInfo.tx.size);
  const txSeq = Number(fileInfo.tx.seq);
  const numChunks = getSplitNum(fileSize, DEFAULT_CHUNK_SIZE);
  const startSeg = Math.floor(Number(fileInfo.tx.startEntryIndex) / DEFAULT_SEGMENT_MAX_CHUNKS);
  const endSeg = Math.floor(
    (Number(fileInfo.tx.startEntryIndex) + numChunks - 1) / DEFAULT_SEGMENT_MAX_CHUNKS,
  );
  const numTasks = endSeg - startSeg + 1;

  const segments: Uint8Array[] = [];
  for (let t = 0; t < numTasks; t++) {
    const startIdx = t * DEFAULT_SEGMENT_MAX_CHUNKS;
    let endIdx = startIdx + DEFAULT_SEGMENT_MAX_CHUNKS;
    if (endIdx > numChunks) endIdx = numChunks;

    let seg: Uint8Array | null = null;
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[(t + i) % nodes.length];
      try {
        const data = await node.downloadSegmentByTxSeq(txSeq, startIdx, endIdx);
        if (!data) continue;
        seg = ethers.decodeBase64(data as string);
        if (startSeg + t === endSeg) {
          const lastChunkSize = fileSize % DEFAULT_CHUNK_SIZE;
          if (lastChunkSize > 0) {
            const pad = DEFAULT_CHUNK_SIZE - lastChunkSize;
            seg = seg.slice(0, seg.length - pad);
          }
        }
        break;
      } catch {
        continue;
      }
    }
    if (!seg) throw new Error(`Failed segment ${t}`);
    segments.push(seg);
  }

  const total = segments.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const s of segments) {
    out.set(s, off);
    off += s.length;
  }
  return out;
}
