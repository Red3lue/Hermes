import { namehash, type Address } from "viem";
import { publicClient } from "./chainConfig";

// Authoritative on-chain ownership check for an ENS name (subname or
// otherwise) on Sepolia. Handles BOTH legacy unwrapped subnames (Registry
// stores the owner directly) AND wrapped subnames (Registry returns the
// NameWrapper address; NameWrapper stores the real owner as an ERC-1155
// balance).
//
// Why not the subgraph: The Sepolia ENS subgraph reports `domains.owner`
// from the Registry only. For wrapped subnames every entry shows the
// NameWrapper contract as owner, hiding the real owner. We were filtering
// on-chain reality through that lens and silently dropping wrapped
// subnames. This module bypasses the subgraph entirely.

const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const NAME_WRAPPER_SEPOLIA: Address =
  "0x0635513f179D50A207757E05759CbD106d7dFcE8";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const NAME_WRAPPER_ABI = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const ZERO: Address = "0x0000000000000000000000000000000000000000";

/** Resolve the *effective* owner of an ENS name. Looks at the Registry
 * first; if the Registry owner is the NameWrapper, peeks into the
 * Wrapper's ownerOf. Returns the zero address if no owner. */
export async function effectiveOwner(name: string): Promise<Address> {
  const node = namehash(name);
  const registryOwner = (await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [node],
  })) as Address;

  if (registryOwner.toLowerCase() !== NAME_WRAPPER_SEPOLIA.toLowerCase()) {
    return registryOwner;
  }

  // Wrapped — ask NameWrapper for the real owner.
  try {
    const wrappedOwner = (await publicClient.readContract({
      address: NAME_WRAPPER_SEPOLIA,
      abi: NAME_WRAPPER_ABI,
      functionName: "ownerOf",
      args: [BigInt(node)],
    })) as Address;
    return wrappedOwner;
  } catch {
    return ZERO;
  }
}

/** Filter a candidate list of ENS names down to the ones whose effective
 * owner matches `ownerAddress`. Calls run in parallel. */
export async function filterOwnedNames(
  candidates: string[],
  ownerAddress: string,
): Promise<string[]> {
  const owner = ownerAddress.toLowerCase();
  const results = await Promise.all(
    candidates.map(async (name) => {
      try {
        const o = await effectiveOwner(name);
        return o.toLowerCase() === owner ? name : null;
      } catch {
        return null;
      }
    }),
  );
  return results.filter((n): n is string => n !== null);
}

/** Discover ENS names owned by a user.
 *
 * Strategy:
 *  1. Pull the candidate set from `known-agents.json` (agents shipped with
 *     the app — coordinator + quorum + chatbot + inactive ones).
 *  2. Fall back to a legacy ENS subgraph query for anything else minted
 *     under the parent domain (best-effort; filters by Registry owner so
 *     wrapped subnames there will be missed, but the on-chain pass below
 *     covers them).
 *  3. Probe each candidate's effective owner on chain and keep matches.
 *
 * Net result: a wallet sees every subname it actually owns, whether
 * wrapped or unwrapped, regardless of subgraph indexing lag.
 */
export async function getOwnedSubnames(
  ownerAddress: string,
  parentEns: string,
): Promise<string[]> {
  const candidates = new Set<string>();

  // (1) static candidates from known-agents.json
  try {
    const r = await fetch("/known-agents.json");
    if (r.ok) {
      const data = (await r.json()) as Record<
        string,
        { ens?: string }
      >;
      for (const v of Object.values(data)) {
        if (v?.ens && v.ens.endsWith(`.${parentEns}`)) {
          candidates.add(v.ens);
        }
      }
    }
  } catch {
    /* ignore */
  }

  // (2) subgraph fallback for legacy unwrapped subnames
  try {
    const subgraphResults = await fetchSubgraphSubdomains(parentEns);
    for (const name of subgraphResults) candidates.add(name);
  } catch {
    /* ignore */
  }

  // (3) on-chain effective-owner probe
  return filterOwnedNames([...candidates], ownerAddress);
}

export async function getOwnedBiomeSubnames(
  ownerAddress: string,
  parentEns: string,
): Promise<string[]> {
  return getOwnedSubnames(ownerAddress, `biomes.${parentEns}`);
}

// --- subgraph fallback (legacy, unwrapped subnames) ----------------------

const ENS_SUBGRAPH =
  "https://api.studio.thegraph.com/query/49574/enssepolia/version/latest";

async function fetchSubgraphSubdomains(parentEns: string): Promise<string[]> {
  const query = `
    query GetSubdomains($first: Int) {
      domains(where: { name: "${parentEns}" }) {
        id
        name
        subdomains(first: $first) {
          id
          name
          labelName
          owner { id }
        }
      }
    }
  `;
  const res = await fetch(ENS_SUBGRAPH, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { first: 200 } }),
  });
  const json = (await res.json()) as {
    data?: {
      domains: Array<{
        subdomains: Array<{ name: string; owner: { id: string } }>;
      }>;
    };
  };
  const domain = json.data?.domains?.[0];
  return domain?.subdomains.map((s) => s.name) ?? [];
}
