import {
  type PublicClient,
  type WalletClient,
  type Account,
  type Hash,
  parseAbi,
  parseAbiItem,
  namehash,
} from "viem";

const HERMES_INBOX_ABI = parseAbi([
  "function send(bytes32 toNode, bytes32 rootHash) external",
  "function reply(bytes32 toNode, bytes32 replyTo, bytes32 rootHash) external",
  "event Message(bytes32 indexed toNode, address indexed from, bytes32 indexed replyTo, bytes32 rootHash, uint256 timestamp)",
]);

const MESSAGE_EVENT = parseAbiItem(
  "event Message(bytes32 indexed toNode, address indexed from, bytes32 indexed replyTo, bytes32 rootHash, uint256 timestamp)",
);

export type InboxMessage = {
  toNode: `0x${string}`; // namehash of recipient
  from: `0x${string}`; // sender address (msg.sender at append time)
  replyTo: `0x${string}`; // bytes32(0) for fresh msgs, else parent rootHash
  rootHash: `0x${string}`; // 0G blob pointer
  timestamp: bigint; // block.timestamp at append
  blockNumber: bigint;
  transactionHash: `0x${string}`;
};

export type InboxConfig = {
  contract: `0x${string}`;
  publicClient: PublicClient;
};

type WithWallet = InboxConfig & { wallet: WalletClient & { account: Account } };

export async function appendToInbox(
  cfg: WithWallet,
  toName: string,
  rootHash: `0x${string}`,
): Promise<Hash> {
  return cfg.wallet.writeContract({
    address: cfg.contract,
    abi: HERMES_INBOX_ABI,
    functionName: "send",
    args: [namehash(toName), rootHash],
    account: cfg.wallet.account,
    chain: cfg.wallet.chain,
  });
}

export async function replyToInbox(
  cfg: WithWallet,
  toName: string,
  replyTo: `0x${string}`,
  rootHash: `0x${string}`,
): Promise<Hash> {
  return cfg.wallet.writeContract({
    address: cfg.contract,
    abi: HERMES_INBOX_ABI,
    functionName: "reply",
    args: [namehash(toName), replyTo, rootHash],
    account: cfg.wallet.account,
    chain: cfg.wallet.chain,
  });
}

// Public RPCs commonly cap eth_getLogs at 50k blocks. Chunk requests to stay
// under that cap and walk back from `latest` so a fresh demo finds recent logs
// without scanning the whole chain.
const LOG_CHUNK_SIZE = 9_000n;
const DEFAULT_LOOKBACK = 200_000n;

async function getLogsChunked(
  cfg: InboxConfig,
  args: {
    event: typeof MESSAGE_EVENT;
    args: Record<string, unknown>;
    fromBlock: bigint;
  },
): Promise<InboxMessage[]> {
  const latest = await cfg.publicClient.getBlockNumber();
  let from = args.fromBlock;
  if (from === 0n && latest > DEFAULT_LOOKBACK) from = latest - DEFAULT_LOOKBACK;

  const out: InboxMessage[] = [];
  while (from <= latest) {
    const to = from + LOG_CHUNK_SIZE - 1n > latest ? latest : from + LOG_CHUNK_SIZE - 1n;
    const logs = await cfg.publicClient.getLogs({
      address: cfg.contract,
      event: args.event,
      args: args.args as never,
      fromBlock: from,
      toBlock: to,
    });
    for (const log of logs) out.push(toInboxMessage(log as never));
    from = to + 1n;
  }
  return out;
}

export async function readInbox(
  cfg: InboxConfig,
  myName: string,
  fromBlock: bigint = 0n,
): Promise<InboxMessage[]> {
  return getLogsChunked(cfg, {
    event: MESSAGE_EVENT,
    args: { toNode: namehash(myName) },
    fromBlock,
  });
}

export async function readReplies(
  cfg: InboxConfig,
  parentRootHash: `0x${string}`,
  fromBlock: bigint = 0n,
): Promise<InboxMessage[]> {
  return getLogsChunked(cfg, {
    event: MESSAGE_EVENT,
    args: { replyTo: parentRootHash },
    fromBlock,
  });
}

function toInboxMessage(log: {
  args: {
    toNode?: `0x${string}`;
    from?: `0x${string}`;
    replyTo?: `0x${string}`;
    rootHash?: `0x${string}`;
    timestamp?: bigint;
  };
  blockNumber: bigint;
  transactionHash: `0x${string}`;
}): InboxMessage {
  return {
    toNode: log.args.toNode!,
    from: log.args.from!,
    replyTo: log.args.replyTo!,
    rootHash: log.args.rootHash!,
    timestamp: log.args.timestamp!,
    blockNumber: log.blockNumber,
    transactionHash: log.transactionHash,
  };
}
