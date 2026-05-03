// 0G blob I/O for the browser, with two read paths:
//
//   - downloadBlobDirect(rootHash) — talks straight to the 0G storage
//     nodes the indexer points at. This is the architecturally-pure
//     "FE-only" path; no backend involvement. Currently blocked from
//     HTTPS-served pages because the storage nodes only expose plain
//     HTTP, so the browser refuses the requests as Mixed Content.
//     Kept around because it WILL work the moment 0G ships HTTPS
//     endpoints, or if the FE is hosted on plain HTTP, or for
//     non-browser callers (electron, mobile WebView with cleartext
//     traffic enabled, etc).
//
//   - downloadBlobViaProxy(rootHash) — calls the agents-server's HTTPS
//     proxy `GET /blob/:root`, which delegates to the 0G SDK
//     server-side. This is what the deployed Cloud Run FE uses today
//     because Mixed Content blocks the direct path.
//
// `downloadBlob` is exported as an alias for the proxy path so
// existing call sites keep working unchanged. Switch to
// `downloadBlobDirect` if/when 0G nodes serve HTTPS.
//
// Uploads (`uploadBlob`) still go direct to 0G via the user's wallet —
// the user pays the 0G tx fee. The chat / quorum / anima paths that
// want the deployer to absorb the fee call `POST /blob` explicitly
// elsewhere; those don't touch this module.

import { Indexer, MemData, StorageNode } from "@0gfoundation/0g-ts-sdk";
import { ethers } from "ethers";
import { ZEROG_RPC, ZEROG_INDEXER } from "./chainConfig";

const AGENTS_SERVER_URL =
  import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";

const DEFAULT_CHUNK_SIZE = 256;
const DEFAULT_SEGMENT_MAX_CHUNKS = 1024;

function getSplitNum(total: number, unit: number): number {
  return Math.floor((total - 1) / unit + 1);
}

// --- uploads (user-paid, direct) ------------------------------------------

export async function uploadBlob(
  bytes: Uint8Array,
  eip1193Provider: unknown,
): Promise<`0x${string}`> {
  const ethersProvider = new ethers.BrowserProvider(
    eip1193Provider as ethers.Eip1193Provider,
  );
  const signer = await ethersProvider.getSigner();
  const memData = new MemData(bytes);
  const indexer = new Indexer(ZEROG_INDEXER);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [tx, err] = await indexer.upload(memData, ZEROG_RPC, signer as any);
  if (err) throw new Error(`0G upload failed: ${err}`);
  if (!("rootHash" in tx)) throw new Error("upload returned no rootHash");
  return tx.rootHash as `0x${string}`;
}

// --- downloads ------------------------------------------------------------

/** Direct FE → 0G storage node download. The architecturally-pure path:
 * indexer → storage node → segments → assemble. No backend in the loop.
 *
 * Blocked from HTTPS-served pages today because 0G storage nodes only
 * expose plain HTTP (Mixed Content). Kept exported so it can be wired
 * back in immediately when 0G provides HTTPS endpoints, or for callers
 * that aren't subject to the browser's Mixed Content rule. */
export async function downloadBlobDirect(
  rootHash: `0x${string}`,
): Promise<Uint8Array> {
  const indexer = new Indexer(ZEROG_INDEXER);
  const locations = await indexer.getFileLocations(rootHash);
  if (!locations || locations.length === 0) throw new Error("File not found");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const nodes: StorageNode[] = (locations as any[]).map(
    (loc) => new StorageNode(loc.url),
  );

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
  const startSeg = Math.floor(
    Number(fileInfo.tx.startEntryIndex) / DEFAULT_SEGMENT_MAX_CHUNKS,
  );
  const endSeg = Math.floor(
    (Number(fileInfo.tx.startEntryIndex) + numChunks - 1) /
      DEFAULT_SEGMENT_MAX_CHUNKS,
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

/** Download a 0G blob via the agents-server HTTPS proxy. Required when
 * the FE is served over HTTPS — otherwise the storage node URLs (plain
 * HTTP) trigger Mixed Content blocks and every read fails silently. */
export async function downloadBlobViaProxy(
  rootHash: `0x${string}`,
): Promise<Uint8Array> {
  const r = await fetch(`${AGENTS_SERVER_URL}/blob/${rootHash}`);
  if (!r.ok) {
    let detail = "";
    try {
      detail = (await r.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    throw new Error(
      `0G download via proxy → ${r.status}${detail ? `: ${detail}` : ""}`,
    );
  }
  const buf = await r.arrayBuffer();
  return new Uint8Array(buf);
}

/** Default download path — currently routes through the proxy because
 * Mixed Content blocks the direct one on Cloud Run / any HTTPS host.
 * Existing callers keep working without changes. Switch the assignment
 * below if/when the direct path becomes viable again. */
export const downloadBlob = downloadBlobViaProxy;
