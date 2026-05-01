import { createPublicClient, http } from "viem";
import { sepolia } from "viem/chains";

export const INBOX_CONTRACT = (import.meta.env.VITE_INBOX_CONTRACT ??
  "0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8") as `0x${string}`;
export const PARENT_ENS = import.meta.env.VITE_PARENT_ENS ?? "hermes.eth";
export const ZEROG_RPC =
  import.meta.env.VITE_ZEROG_RPC ?? "https://evmrpc-testnet.0g.ai";
export const ZEROG_INDEXER =
  import.meta.env.VITE_ZEROG_INDEXER ??
  "https://indexer-storage-testnet-turbo.0g.ai";
export const SEPOLIA_RPC =
  import.meta.env.VITE_SEPOLIA_RPC ??
  "https://ethereum-sepolia-rpc.publicnode.com";

export const publicClient = createPublicClient({
  chain: sepolia,
  transport: http(SEPOLIA_RPC),
});
