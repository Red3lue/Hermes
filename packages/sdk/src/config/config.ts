import { http } from "@wagmi/core";
import { sepolia } from "@wagmi/core/chains";
import { createPublicClient } from "viem";
import { addEnsContracts } from "@ensdomains/ensjs";

export const client = createPublicClient({
  chain: addEnsContracts(sepolia),
  transport: http(),
});
