import { Link, useNavigate } from "react-router-dom";
import { useState, useMemo } from "react";
import { keccak256, toBytes } from "viem";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import { setAgentRecords } from "@hermes/sdk";
import { publishAnima } from "@/lib/animaClient";
import { WalletButton } from "@/components/WalletButton";
import { useWallet } from "@/hooks/useWallet";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";

const { encodeBase64 } = naclUtil;

const BASE = import.meta.env.VITE_AGENTS_SERVER_URL ?? "http://localhost:8787";
const AGENTS_PARENT =
  import.meta.env.VITE_AGENTS_PARENT ?? "hermes.eth";

/** Derive a per-agent X25519 keypair deterministically from a wallet
 * signature over a message that includes the agent's ENS. Same wallet +
 * same ens = same keys; different ens = different keys. */
async function deriveAgentX25519(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  wallet: any,
  address: `0x${string}`,
  ens: string,
): Promise<{ pubkey: string; secretKey: string }> {
  const message = `Hermes agent identity v1: ${ens}`;
  const sig = await wallet.signMessage({ account: address, message });
  const seed = keccak256(toBytes(sig));
  const seedBytes = Buffer.from(seed.slice(2), "hex");
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  return {
    pubkey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

type Step =
  | { kind: "idle" }
  | { kind: "minting" }
  | { kind: "deriving" }
  | { kind: "records" }
  | { kind: "anima" }
  | { kind: "done"; ens: string }
  | { kind: "error"; message: string };

export default function AgentNew() {
  const navigate = useNavigate();
  const { address, walletClient } = useWallet();

  const [label, setLabel] = useState("");
  const [animaContent, setAnimaContent] = useState("");
  const [step, setStep] = useState<Step>({ kind: "idle" });

  const ens = useMemo(
    () => (label ? `${label}.${AGENTS_PARENT}` : ""),
    [label],
  );
  const labelOk = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(label);
  const ready = !!walletClient && !!address && labelOk;

  async function create() {
    if (!walletClient || !address) return;
    try {
      // 1. Mint <label>.hermes.eth via the deployer (deployer owns hermes.eth
      //    wrapped). The deployer transfers ownership of the wrapped subname
      //    to the user's wallet.
      setStep({ kind: "minting" });
      const mintR = await fetch(`${BASE}/register-agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address, label }),
      });
      if (!mintR.ok) {
        const j = (await mintR.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `register-agent → ${mintR.status}`);
      }

      // 2. Derive a per-agent X25519 keypair from a wallet sig over a
      //    message that includes the ens. Same wallet+ens = same keys.
      setStep({ kind: "deriving" });
      const keys = await deriveAgentX25519(walletClient, address, ens);

      // 3. Set ENS records (addr + hermes.pubkey + hermes.inbox).
      //    User wallet now owns the subname → multicall succeeds.
      setStep({ kind: "records" });
      await setAgentRecords(
        ens,
        {
          addr: address,
          pubkey: keys.pubkey,
          inbox: INBOX_CONTRACT,
        },
        publicClient,
        walletClient as never,
      );

      // 4. (Optional) publish initial Anima — encrypted with the agent's
      //    own keys (self-box). Reuse the keys we just derived.
      if (animaContent.trim()) {
        setStep({ kind: "anima" });
        await publishAnima({
          ens,
          ownerAddr: address,
          ownerPubkey: keys.pubkey,
          ownerSecretKey: keys.secretKey,
          content: animaContent.trim(),
          walletClient,
        });
      }

      setStep({ kind: "done", ens });
    } catch (err) {
      setStep({ kind: "error", message: (err as Error).message });
    }
  }

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">
      <nav className="border-b border-gray-800 px-6 py-3 flex items-center gap-4">
        <Link to="/" className="font-mono font-bold text-hermes-400">
          hermes
        </Link>
        <span className="text-gray-700">/</span>
        <Link
          to="/dashboard"
          className="text-gray-400 text-sm hover:text-gray-200"
        >
          dashboard
        </Link>
        <span className="text-gray-700">/</span>
        <span className="text-gray-300 text-sm font-semibold">new agent</span>
        <div className="ml-auto">
          <WalletButton />
        </div>
      </nav>

      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-2xl font-bold mb-2">Create a new agent</h1>
        <p className="text-sm text-gray-400 mb-8 leading-relaxed">
          Mints <code>&lt;label&gt;.{AGENTS_PARENT}</code> owned by your
          wallet, derives a fresh X25519 keypair from a deterministic
          signature, and writes the <code>hermes.pubkey</code> /{" "}
          <code>hermes.inbox</code> / <code>addr</code> ENS records. Optionally
          publishes an Anima at creation time. After this the agent is
          addressable from anywhere — anyone can send sealed envelopes to
          it; only the wallet that signed can decrypt.
        </p>

        {!address && (
          <div className="mb-6 rounded-lg border border-yellow-900 bg-yellow-950/20 p-3 text-sm text-yellow-300">
            Connect your wallet to create an agent.
          </div>
        )}

        {/* Label */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
            Agent label
          </label>
          <div className="flex items-center gap-2">
            <input
              className="flex-1 rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono focus:border-hermes-600 focus:outline-none"
              placeholder="researcher"
              value={label}
              onChange={(e) => setLabel(e.target.value.toLowerCase())}
              disabled={step.kind !== "idle" && step.kind !== "error"}
            />
            <span className="text-sm font-mono text-gray-500">
              .{AGENTS_PARENT}
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

        {/* Anima (optional) */}
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-5 mb-5">
          <label className="block text-xs font-mono uppercase tracking-widest text-gray-500 mb-2">
            Anima — soul of the agent (optional)
          </label>
          <p className="text-xs text-gray-600 mb-2">
            Markdown content the agent will load before answering. Skip
            and publish later from the agent's detail page if you prefer.
          </p>
          <textarea
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-mono resize-y focus:border-hermes-600 focus:outline-none"
            rows={6}
            value={animaContent}
            onChange={(e) => setAnimaContent(e.target.value)}
            placeholder={`# I am ${label || "<label>"}\n\nMy role is …\nMy domain is …`}
            disabled={step.kind !== "idle" && step.kind !== "error"}
          />
        </div>

        {/* Action */}
        <div className="flex items-center gap-3 mt-6">
          <button
            onClick={create}
            disabled={
              !ready ||
              (step.kind !== "idle" &&
                step.kind !== "error" &&
                step.kind !== "done")
            }
            className="rounded-md bg-hermes-600 px-5 py-2.5 text-sm font-semibold hover:bg-hermes-500 disabled:opacity-50 transition-colors"
          >
            {step.kind === "idle" ||
            step.kind === "error" ||
            step.kind === "done"
              ? "Create agent"
              : stepLabel(step)}
          </button>
          {step.kind === "done" && (
            <button
              onClick={() =>
                navigate(`/agents/${encodeURIComponent(step.ens)}`)
              }
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
            ✓ {step.ens} is live. The agent is addressable from anywhere
            via its ENS. Re-derive its keys any time by signing the same
            message with the same wallet.
          </p>
        )}

        <p className="mt-6 text-xs text-gray-700 leading-relaxed">
          Cost: 1 Sepolia tx (mint subname, paid by the deployer) · 1
          wallet sig (derive X25519 keypair) · 1 Sepolia tx (set ENS
          records, paid by you){animaContent.trim() &&
            " · 1 wallet sig + 1 0G upload + 1 Sepolia tx (publish Anima)"}.
        </p>
      </div>
    </div>
  );
}

function stepLabel(s: Step): string {
  switch (s.kind) {
    case "minting":
      return "Minting subname…";
    case "deriving":
      return "Deriving X25519 keypair…";
    case "records":
      return "Writing ENS records…";
    case "anima":
      return "Publishing anima…";
    default:
      return "Create agent";
  }
}
