import { http } from "@wagmi/core";
import { sepolia } from "@wagmi/core/chains";
import { createPublicClient } from "viem";

export const client = createPublicClient({
  chain: sepolia,
  transport: http(),
});
