import type { InboxMessage } from "hermes-agents-sdk";

const EXPLORER = "https://sepolia.etherscan.io";

type Props = {
  messages: InboxMessage[];
};

export function OnChainPanel({ messages }: Props) {
  return (
    <div className="space-y-2">
      {messages.length === 0 && (
        <p className="text-xs text-gray-500 font-mono">No on-chain events yet.</p>
      )}
      {[...messages]
        .reverse()
        .slice(0, 20)
        .map((m) => (
          <div
            key={m.transactionHash}
            className="rounded-md border border-hermes-700/30 bg-ink-900/60 p-2.5 text-xs font-mono"
          >
            <div className="flex items-center justify-between gap-2 flex-wrap">
              <span className="text-gray-500">
                block {m.blockNumber.toString()}
              </span>
              <a
                href={`${EXPLORER}/tx/${m.transactionHash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-hermes-300 hover:text-hermes-200 truncate max-w-[140px]"
              >
                {m.transactionHash.slice(0, 10)}…
              </a>
            </div>
            <p className="text-gray-500 mt-1 truncate">
              root · {m.rootHash.slice(0, 22)}…
            </p>
            <p className="text-gray-600 truncate">
              from · {m.from.slice(0, 12)}…
            </p>
          </div>
        ))}
    </div>
  );
}
