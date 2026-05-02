import { Link, useNavigate } from "react-router-dom";
import { useState, useEffect, useMemo } from "react";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import {
  namehash,
  keccak256,
  stringToBytes,
  type Address,
} from "viem";
import {
  signEIP191,
  envelopeSigningPayload,
  resolveAgent,
  setBiomeRecords,
  wrapKey,
  biomeSigningPayload,
  type BiomeDoc,
  type BiomeMember,
  type UnsignedBiomeDoc,
} from "hermes-agents-sdk";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useWallet";
import { useUserAgent } from "@/hooks/useUserAgent";
import { useKnownAgents } from "@/hooks/useKnownAgents";
import { deriveX25519FromWallet } from "@/lib/userIdentity";
import { publicClient } from "@/lib/chainConfig";

const { encodeBase64 } = naclUtil;

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";
const BIOMES_PARENT =
  import.meta.env.VITE_BIOMES_PARENT ?? "biomes.hermes.eth";

// Sepolia ENS Registry + standard PublicResolver. We mint the biome
// subname directly from the user's wallet via setSubnodeRecord — works
// when the user owns the parent name (like in the current demo setup
// where 0x1032… owns biomes.hermes.eth). The server-side /register-biome
// route is a fallback for environments where the deployer owns the parent.
const ENS_REGISTRY: Address = "0x00000000000C2E074eC69A0dFb2997BA6C7d2e1e";
const PUBLIC_RESOLVER: Address =
  "0xE99638b40E4Fff0129D56f03b55b6bbC4BBE49b5";

const REGISTRY_ABI = [
  {
    type: "function",
    name: "owner",
    stateMutability: "view",
    inputs: [{ name: "node", type: "bytes32" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "setSubnodeRecord",
    stateMutability: "nonpayable",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "label", type: "bytes32" },
      { name: "owner", type: "address" },
      { name: "resolver", type: "address" },
      { name: "ttl", type: "uint64" },
    ],
    outputs: [],
  },
] as const;

// Mirrors `canonicalize` from the SDK envelope module.
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined)
    .sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(obj[k])}`).join(",")}}`;
}

async function uploadViaProxy(bytes: Uint8Array): Promise<`0x${string}`> {
  const r = await fetch(`${BASE}/blob`, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: bytes as BodyInit,
  });
  if (!r.ok) throw new Error(`proxy upload → ${r.status}`);
  const j = (await r.json()) as { rootHash: `0x${string}` };
  return j.rootHash;
}

type Step =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "resolving" }
  | { kind: "signing" }
  | { kind: "uploading" }
  | { kind: "registering" }
  | { kind: "done"; ens: string }
  | { kind: "error"; message: string };

export default function BiomeNew() {
  const navigate = useNavigate();
  const { address, walletClient } = useWallet();
  const user = useUserAgent();
  const knownAgents = useKnownAgents();

  const [label, setLabel] = useState("");
  const [goal, setGoal] = useState(
    "Decide proposals via a coordinated quorum of agents.",
  );
  const [memberInput, setMemberInput] = useState("");
  const [memberEns, setMemberEns] = useState<string[]>([]);
  const [step, setStep] = useState<Step>({ kind: "idle" });

  // Pre-populate members the first time the user lands on the page:
  // their own ENS + all known quorum-role agents.
  useEffect(() => {
    if (memberEns.length > 0) return;
    const seeded: string[] = [];
    if (user.identity?.ens) seeded.push(user.identity.ens);
    for (const a of Object.values(knownAgents)) {
      if (a.role === "quorum" && a.ens && !seeded.includes(a.ens)) {
        seeded.push(a.ens);
      }
    }
    if (seeded.length > 0) setMemberEns(seeded);
  }, [user.identity?.ens, knownAgents, memberEns.length]);

  const ens = useMemo(
    () => (label ? `${label}.${BIOMES_PARENT}` : ""),
    [label],
  );
  const labelOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label);
  const ready =
    !!walletClient &&
    !!address &&
    user.status === "ready" &&
    labelOk &&
    !!goal.trim() &&
    memberEns.length >= 2;

  function addMember() {
    const v = memberInput.trim().toLowerCase();
    if (!v) return;
    if (memberEns.includes(v)) {
      setMemberInput("");
      return;
    }
    setMemberEns((prev) => [...prev, v]);
    setMemberInput("");
  }

  function removeMember(ens: string) {
    setMemberEns((prev) => prev.filter((e) => e !== ens));
  }

  async function create() {
    if (!walletClient || !address || !user.identity?.ens) return;
    setStep({ kind: "minting" });
    try {
      // 1. Mint the biome ENS subname. Two paths:
      //    a) The connected wallet owns the parent → mint directly via
      //       Registry.setSubnodeRecord. No server hop, no gas from the
      //       deployer.
      //    b) The deployer owns the parent → fall back to /register-biome
      //       which uses the deployer wallet.
      //
      // We probe parent ownership first to pick the right path.
      const parentNode = namehash(BIOMES_PARENT);
      const parentOwner = (await publicClient.readContract({
        address: ENS_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "owner",
        args: [parentNode],
      })) as Address;

      const targetNode = namehash(ens);
      const existingOwner = (await publicClient.readContract({
        address: ENS_REGISTRY,
        abi: REGISTRY_ABI,
        functionName: "owner",
        args: [targetNode],
      })) as Address;

      if (
        existingOwner !== "0x0000000000000000000000000000000000000000" &&
        existingOwner.toLowerCase() !== address.toLowerCase()
      ) {
        throw new Error(`${ens} is already owned by ${existingOwner}`);
      }

      if (existingOwner.toLowerCase() === address.toLowerCase()) {
        // Already minted to this user — skip mint, proceed to records.
      } else if (parentOwner.toLowerCase() === address.toLowerCase()) {
        // User owns the parent — direct Registry mint.
        const labelHash = keccak256(stringToBytes(label));
        const tx = await walletClient.writeContract({
          address: ENS_REGISTRY,
          abi: REGISTRY_ABI,
          functionName: "setSubnodeRecord",
          args: [parentNode, labelHash, address, PUBLIC_RESOLVER, 0n],
          account: walletClient.account!,
          chain: walletClient.chain ?? null,
        });
        await publicClient.waitForTransactionReceipt({ hash: tx });
      } else {
        // Server-managed parent — let the deployer mint.
        const mintR = await fetch(`${BASE}/register-biome`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ address, label }),
        });
        if (!mintR.ok) {
          const j = (await mintR.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(j.error ?? `register-biome → ${mintR.status}`);
        }
      }

      // 2. Resolve every member's pubkey via their ENS records.
      setStep({ kind: "resolving" });
      const members: BiomeMember[] = [];
      for (const e of memberEns) {
        try {
          const r = await resolveAgent(e, publicClient);
          members.push({ ens: e, pubkey: r.pubkey });
        } catch (err) {
          throw new Error(
            `resolve ${e}: ${(err as Error).message}. ` +
              `Make sure the agent has set hermes.pubkey on ENS.`,
          );
        }
      }
      if (!members.some((m) => m.ens === user.identity!.ens)) {
        throw new Error("you must be in the members list");
      }

      // 3. Re-derive the user's X25519 keypair (not persisted).
      const myKeys = await deriveX25519FromWallet(walletClient, address);

      // 4. Build the unsigned BiomeDoc with K + per-member wraps.
      setStep({ kind: "signing" });
      const K = nacl.randomBytes(32);
      const wraps: Record<string, { ciphertext: string; nonce: string }> = {};
      for (const m of members) {
        wraps[m.ens] = wrapKey(K, m.pubkey, myKeys.secretKey);
      }
      const unsigned: UnsignedBiomeDoc = {
        v: 1,
        name: ens,
        goal: goal.trim(),
        rules: {},
        members,
        wraps,
        ownerEns: user.identity.ens,
        ownerPubkey: myKeys.pubkey,
        version: 1,
        createdAt: Math.floor(Date.now() / 1000),
      };
      const sig = await signEIP191(
        walletClient as never,
        biomeSigningPayload(unsigned),
      );
      const doc: BiomeDoc = { ...unsigned, sig };

      // 5. Upload the BiomeDoc blob via the deployer-paid 0G proxy.
      setStep({ kind: "uploading" });
      const blob = new TextEncoder().encode(canonicalize(doc));
      const root = await uploadViaProxy(blob);

      // 6. Write biome.root + biome.version to ENS (user wallet pays gas).
      setStep({ kind: "registering" });
      await setBiomeRecords(
        ens,
        root,
        1,
        publicClient,
        walletClient as never,
      );

      // The new biome will appear in the dashboard automatically — the
      // on-chain owner discovery in useMyBiomes picks it up on next mount.

      setStep({ kind: "done", ens });
    } catch (err) {
      setStep({ kind: "error", message: (err as Error).message });
    }
  }

  // Suppress unused warning — the canonicalize wrap on signing already
  // covers the envelopeSigningPayload import for tree-shake friendliness.
  void envelopeSigningPayload;
  void encodeBase64;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link
          to="/biomes"
          className="text-gray-400 text-sm hover:text-gray-200"
        >
          biomes
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-semibold">new biome</span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Create a new biome</h1>
        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
          Mints <code>&lt;label&gt;.{BIOMES_PARENT}</code> owned by your wallet,
          generates a fresh symmetric key <code>K</code>, wraps it for each
          member, signs the BiomeDoc, uploads to 0G, and sets the ENS records.
          You become both the ENS-level owner and the BiomeDoc owner — you can
          add/remove members and publish/edit the Animus afterward.
        </p>

        {(!address || user.status !== "ready") && (
          <div className="mb-6 rounded-lg border border-yellow-900 bg-yellow-950/20 p-3 text-sm text-yellow-300">
            Connect your wallet and complete user setup (Sign + Register +
            Records) on the Quorum demo page first. You need a{" "}
            <code>users.hermes.eth</code> ENS to be the BiomeDoc owner.
          </div>
        )}

        {/* Label */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
            Biome label
          </label>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:border-hermes-600 focus:outline-none"
              placeholder="research-pod"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
              disabled={step.kind !== "idle" && step.kind !== "error"}
            />
            <span className="text-sm font-mono text-gray-500">
              .{BIOMES_PARENT}
            </span>
          </div>
          {label && !labelOk && (
            <p className="mt-2 text-xs text-red-400">
              3–32 chars · lowercase a-z, 0-9, hyphen · must start & end alphanumeric
            </p>
          )}
          {ens && labelOk && (
            <p className="mt-2 text-xs font-mono text-gray-600">
              full name: <span className="text-hermes-400">{ens}</span>
            </p>
          )}
        </div>

        {/* Goal */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
            Goal / charter
          </label>
          <textarea
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm focus:border-hermes-600 focus:outline-none resize-y"
            rows={2}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
            disabled={step.kind !== "idle" && step.kind !== "error"}
          />
        </div>

        {/* Members */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
            Members ({memberEns.length})
          </label>
          <p className="text-xs text-gray-600 mb-3">
            Each member must already have <code>hermes.pubkey</code> set on
            their ENS. Members can decrypt biome traffic; non-members see only
            ciphertext on chain.
          </p>
          <div className="space-y-1.5 mb-3">
            {memberEns.map((e) => {
              const known = Object.values(knownAgents).find(
                (ka) => ka.ens === e,
              );
              const isOwner = e === user.identity?.ens;
              return (
                <div
                  key={e}
                  className="flex items-center gap-2 rounded-md border border-gray-800 bg-gray-950/40 px-3 py-1.5 text-xs font-mono"
                >
                  <span className="flex-1 truncate text-gray-300">
                    {e}
                    {known?.displayName && (
                      <span className="ml-2 text-gray-600">
                        — {known.displayName}
                      </span>
                    )}
                  </span>
                  {isOwner && (
                    <span className="text-emerald-400">you (owner)</span>
                  )}
                  {!isOwner && (
                    <button
                      onClick={() => removeMember(e)}
                      className="text-red-400 hover:text-red-300"
                      disabled={
                        step.kind !== "idle" && step.kind !== "error"
                      }
                    >
                      remove
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          <div className="flex gap-2">
            <input
              className="flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm font-mono placeholder-gray-700 focus:border-hermes-600 focus:outline-none"
              placeholder="<ens>.hermes.eth"
              value={memberInput}
              onChange={(e) => setMemberInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addMember()}
              disabled={step.kind !== "idle" && step.kind !== "error"}
            />
            <button
              onClick={addMember}
              disabled={
                !memberInput.trim() ||
                (step.kind !== "idle" && step.kind !== "error")
              }
              className="rounded-md border border-gray-700 px-3 py-1.5 text-xs font-semibold hover:border-gray-600 disabled:opacity-50"
            >
              + Add
            </button>
          </div>
        </div>

        {/* Action */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={create}
            disabled={!ready || (step.kind !== "idle" && step.kind !== "error" && step.kind !== "done")}
            className="rounded-md bg-hermes-600 px-5 py-2.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
          >
            {step.kind === "idle" || step.kind === "error" || step.kind === "done"
              ? "Create biome"
              : stepLabel(step)}
          </button>
          {step.kind === "done" && (
            <button
              onClick={() => navigate(`/biomes/${encodeURIComponent(step.ens)}`)}
              className="text-sm text-hermes-400 hover:text-hermes-300"
            >
              Open {step.ens} →
            </button>
          )}
        </div>

        {step.kind === "error" && (
          <p className="mt-3 text-sm text-red-400 whitespace-pre-wrap">
            {step.message}
          </p>
        )}

        {step.kind === "done" && (
          <p className="mt-3 text-sm text-emerald-400">
            ✓ {step.ens} is live. Now you can publish an Animus, add/remove
            members, and the agents will pick it up on their next poll.
          </p>
        )}

        <p className="mt-6 text-xs text-gray-700 leading-relaxed">
          Cost: 1 Sepolia tx (mint subname, paid by the deployer) · 1 wallet
          sig (sign BiomeDoc) · 1 0G upload (via deployer proxy) · 1 Sepolia
          tx (set biome.root + biome.version, paid by your wallet).
        </p>
      </div>
    </div>
  );
}

function stepLabel(s: Step): string {
  switch (s.kind) {
    case "minting":
      return "Minting subname…";
    case "resolving":
      return "Resolving member pubkeys…";
    case "signing":
      return "Wrapping K & signing doc…";
    case "uploading":
      return "Uploading to 0G…";
    case "registering":
      return "Writing ENS records…";
    default:
      return "Create biome";
  }
}
