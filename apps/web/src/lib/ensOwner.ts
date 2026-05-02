import { namehash, type PublicClient, type Address } from "viem";
import { normalize } from "viem/ens";

// ENS Registry is the same address on mainnet and Sepolia.
const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
// Sepolia NameWrapper (for wrapped names, the registry returns this address;
// real owner is then NameWrapper.ownerOf(uint256(node))).
const NAME_WRAPPER: Address = "0x0635513f179D50A207757E05759CbD106d7dFcE8";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

export async function getEnsOwner(
  name: string,
  client: PublicClient,
): Promise<Address> {
  const node = namehash(normalize(name));
  const registryOwner = await client.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  });
  if (
    registryOwner.toLowerCase() === NAME_WRAPPER.toLowerCase()
  ) {
    return await client.readContract({
      address: NAME_WRAPPER,
      abi: WRAPPER_ABI,
      functionName: "ownerOf",
      args: [BigInt(node)],
    });
  }
  return registryOwner;
}
