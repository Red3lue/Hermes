import { Router, type Router as ExpressRouter } from "express";
import {
  createPublicClient,
  createWalletClient,
  http,
  namehash,
  type Address,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";
import { createSubname } from "@ensdomains/ensjs/wallet";

export const registerRouter: ExpressRouter = Router();

const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const USERS_PARENT =
  process.env.HERMES_USERS_PARENT ?? "users.hermes.eth";
const BIOMES_PARENT =
  process.env.HERMES_BIOMES_PARENT ?? "biomes.hermes.eth";

const VALID_LABEL_RE = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

function ensChainAndClients() {
  const ensChain = addEnsContracts(sepolia);
  const rpcUrl = process.env.SEPOLIA_RPC_URL!;
  const deployerKey = (process.env.DEPLOYER_PRIVATE_KEY ?? "") as `0x${string}`;
  if (!rpcUrl || !deployerKey) {
    throw new Error("SEPOLIA_RPC_URL and DEPLOYER_PRIVATE_KEY required");
  }
  const publicClient = createPublicClient({
    chain: ensChain,
    transport: http(rpcUrl),
  });
  const wallet = createWalletClient({
    account: privateKeyToAccount(deployerKey),
    chain: ensChain,
    transport: http(rpcUrl),
  });
  return { publicClient, wallet };
}

function deriveLabel(address: string): string {
  return address.toLowerCase().replace(/^0x/, "").slice(0, 12);
}

async function ownerOf(
  publicClient: ReturnType<typeof ensChainAndClients>["publicClient"],
  name: string,
): Promise<Address> {
  return (await publicClient.readContract({
    address: ENS_REGISTRY,
    abi: REGISTRY_ABI,
    functionName: "owner",
    args: [namehash(name)],
  })) as Address;
}

// POST /register-user
//   body: { address: "0x..." }
//   - derives a label from the address
//   - if <label>.users.hermes.eth doesn't exist OR is owned by deployer:
//       mint as a NameWrapper subname owned by the user's address
//   - if it exists and is already owned by the user: idempotent no-op
//   - if owned by someone else: append a 4-char nonce and retry once
//   response: { ens, owner, txHash? }
//
// After this, the user's FE calls setAgentRecords(...) themselves via their
// own wallet to set hermes.pubkey + hermes.inbox + addr.
registerRouter.post("/register-user", async (req, res) => {
  const { address } = req.body as { address?: string };
  if (
    typeof address !== "string" ||
    !address.startsWith("0x") ||
    address.length !== 42
  ) {
    res.status(400).json({ error: "address (0x-prefixed, 42 chars) required" });
    return;
  }

  let publicClient: ReturnType<typeof ensChainAndClients>["publicClient"];
  let wallet: ReturnType<typeof ensChainAndClients>["wallet"];
  try {
    ({ publicClient, wallet } = ensChainAndClients());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  const userAddr = address as Address;
  const baseLabel = deriveLabel(userAddr);

  // Try base label, then base+nonce on collision.
  for (let attempt = 0; attempt < 3; attempt++) {
    const label = attempt === 0
      ? baseLabel
      : `${baseLabel.slice(0, 8)}${Math.random().toString(16).slice(2, 6)}`;
    const ens = `${label}.${USERS_PARENT}`;

    let currentOwner: Address;
    try {
      currentOwner = await ownerOf(publicClient, ens);
    } catch (err) {
      res.status(502).json({
        error: `ENS lookup failed for ${ens}: ${(err as Error).message}`,
      });
      return;
    }

    // Already owned by this user → idempotent success
    if (currentOwner.toLowerCase() === userAddr.toLowerCase()) {
      res.json({ ens, owner: userAddr, alreadyOwned: true });
      return;
    }

    // Owned by deployer (e.g. previous failed transfer) → re-attempt transfer
    // by reissuing the subname with the user as new owner.
    // Owned by zero address → fresh mint
    // Owned by someone else → collision, try a different label.
    const isFreeOrOurs =
      currentOwner === "0x0000000000000000000000000000000000000000" ||
      currentOwner.toLowerCase() ===
        wallet.account!.address.toLowerCase();

    if (!isFreeOrOurs) {
      // Collision; try the next label.
      continue;
    }

    try {
      const txHash = await createSubname(wallet, {
        name: ens,
        contract: "nameWrapper",
        owner: userAddr,
      });
      await publicClient.waitForTransactionReceipt({ hash: txHash });
      res.json({ ens, owner: userAddr, txHash });
      return;
    } catch (err) {
      // If parent isn't wrapped or deployer isn't owner of users.hermes.eth,
      // surface a clear error.
      res.status(500).json({
        error: `subname mint failed for ${ens}: ${(err as Error).message.split("\n")[0]}`,
      });
      return;
    }
  }

  res.status(409).json({
    error: `could not allocate a free label under ${USERS_PARENT} after 3 attempts`,
  });
});

// POST /register-biome
//   body: { address: "0x...", label: "research-pod" }
//   - validates label
//   - mints `<label>.biomes.hermes.eth` as a NameWrapper subname owned by
//     the user's address. Idempotent if already owned by them.
//   - returns { ens, owner, txHash? }
//
// After this the user's FE creates the BiomeDoc, uploads to 0G, and writes
// biome.root + biome.version (paid by user wallet, since they own the
// subname after this mint).
registerRouter.post("/register-biome", async (req, res) => {
  const { address, label } = req.body as {
    address?: string;
    label?: string;
  };
  if (
    typeof address !== "string" ||
    !address.startsWith("0x") ||
    address.length !== 42
  ) {
    res.status(400).json({ error: "address (0x-prefixed, 42 chars) required" });
    return;
  }
  if (typeof label !== "string" || !VALID_LABEL_RE.test(label)) {
    res.status(400).json({
      error:
        "label must be 3–32 chars, lowercase a-z/0-9/-, and start+end with alphanumeric",
    });
    return;
  }

  let publicClient: ReturnType<typeof ensChainAndClients>["publicClient"];
  let wallet: ReturnType<typeof ensChainAndClients>["wallet"];
  try {
    ({ publicClient, wallet } = ensChainAndClients());
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  const userAddr = address as Address;
  const ens = `${label}.${BIOMES_PARENT}`;

  let currentOwner: Address;
  try {
    currentOwner = await ownerOf(publicClient, ens);
  } catch (err) {
    res.status(502).json({
      error: `ENS lookup failed for ${ens}: ${(err as Error).message}`,
    });
    return;
  }

  // Already owned by this user → idempotent success
  if (currentOwner.toLowerCase() === userAddr.toLowerCase()) {
    res.json({ ens, owner: userAddr, alreadyOwned: true });
    return;
  }

  const isFreeOrOurs =
    currentOwner === "0x0000000000000000000000000000000000000000" ||
    currentOwner.toLowerCase() === wallet.account!.address.toLowerCase();

  if (!isFreeOrOurs) {
    res.status(409).json({
      error: `${ens} already taken by ${currentOwner}`,
    });
    return;
  }

  try {
    const txHash = await createSubname(wallet, {
      name: ens,
      contract: "nameWrapper",
      owner: userAddr,
    });
    await publicClient.waitForTransactionReceipt({ hash: txHash });
    res.json({ ens, owner: userAddr, txHash });
  } catch (err) {
    res.status(500).json({
      error: `biome subname mint failed for ${ens}: ${(err as Error).message.split("\n")[0]}`,
    });
  }
});
