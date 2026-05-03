import { useState, useEffect, useCallback } from "react";
import { keccak256, toBytes } from "viem";
import nacl from "tweetnacl";
import naclUtil from "tweetnacl-util";
import {
  decryptMessage,
  generateKeyPairFromSignature,
} from "hermes-agents-sdk";
import { peekAnimaFE, publishAnima } from "@/lib/animaClient";
import { effectiveOwner } from "@/lib/ensSubnames";
import { useWallet } from "@/hooks/useWallet";
import { useKnownAgents } from "@/hooks/useKnownAgents";

const { encodeBase64 } = naclUtil;

type Peek = {
  root: `0x${string}`;
  ownerAddr: `0x${string}`;
  ownerPubkey: string;
  ciphertext: string;
  nonce: string;
  createdAt: number;
};

type State =
  | { kind: "loading" }
  | { kind: "absent" }
  | { kind: "encrypted"; peek: Peek }
  | { kind: "decrypted"; peek: Peek; content: string }
  | { kind: "error"; message: string };

/** Derive an agent's X25519 keypair via the FE per-ENS scheme. Used for
 * user-created agents (those produced by `/agents/new`, which signs
 * `Hermes agent identity v1: <ens>` to derive their keypair). Same
 * wallet+ens → same keypair. */
async function deriveAgentX25519PerEns(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: any,
  address: `0x${string}`,
  ens: string,
): Promise<{ pubkey: string; secretKey: string }> {
  const message = `Hermes agent identity v1: ${ens}`;
  const sig = await walletClient.signMessage({ account: address, message });
  const seed = keccak256(toBytes(sig));
  const seedBytes = Buffer.from(seed.slice(2), "hex");
  const kp = nacl.box.keyPair.fromSecretKey(seedBytes);
  return {
    pubkey: encodeBase64(kp.publicKey),
    secretKey: encodeBase64(kp.secretKey),
  };
}

/** Pick the correct derivation scheme for an agent based on its known
 * metadata.
 *
 *   - When the agent has a registered `x25519Version` in known-agents.json
 *     (selector, experts, quorum, concierge — all server-seeded agents):
 *     use the SDK's versioned scheme. Signs `hermes-keygen-v<N>`. This
 *     matches what `seed-agents.ts` and the runtime keystore-prep use,
 *     so the derived pubkey is the one published as `hermes.pubkey` on
 *     ENS and the one referenced in any AnimaDoc the runtime built.
 *
 *   - Otherwise (the agent is unknown to the FE — typically a
 *     user-created agent from /agents/new): fall back to the FE per-ENS
 *     scheme. Signs `Hermes agent identity v1: <ens>`. This matches what
 *     AgentNew.tsx uses on creation, so the derived pubkey matches the
 *     `hermes.pubkey` AgentNew published.
 *
 * Critical for not breaking creation flows: this function never runs at
 * agent or biome or user *creation* time. Those flows derive their own
 * keys directly (AgentNew → `Hermes agent identity v1: <ens>`,
 * BiomeNew → user's own keypair via `deriveX25519FromWallet`,
 * useUserAgent → `Hermes user identity v1`). AnimaPanel only calls
 * this when reading or editing an existing Anima. */
async function deriveAgentKeypair(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  walletClient: any,
  address: `0x${string}`,
  ens: string,
  knownVersion: number | undefined,
): Promise<{ pubkey: string; secretKey: string }> {
  if (typeof knownVersion === "number" && knownVersion > 0) {
    // SDK helper returns { publicKey, secretKey }; rename the field
    // for FE-internal consistency.
    const kp = await generateKeyPairFromSignature(walletClient, knownVersion);
    return { pubkey: kp.publicKey, secretKey: kp.secretKey };
  }
  return deriveAgentX25519PerEns(walletClient, address, ens);
}

export function AnimaPanel({ ens }: { ens: string }) {
  const { address, walletClient } = useWallet();
  const knownAgents = useKnownAgents();
  const [state, setState] = useState<State>({ kind: "loading" });
  const [ensOwnerAddr, setEnsOwnerAddr] = useState<`0x${string}` | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState<"decrypt" | "publish" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [decryptError, setDecryptError] = useState<string | null>(null);

  // Look up the agent's registered key version (if it's a server-seeded
  // agent we ship with). User-created agents won't be in known-agents.json
  // and will fall through to the FE per-ENS derivation scheme below.
  const knownVersion = Object.values(knownAgents).find(
    (a) => a.ens === ens,
  )?.x25519Version;

  // Resolve the on-chain ENS owner. Only this wallet can successfully
  // call setText on the resolver — gate the publish/edit affordances
  // on it so we don't show a button that's guaranteed to revert.
  useEffect(() => {
    let cancelled = false;
    effectiveOwner(ens)
      .then((o) => !cancelled && setEnsOwnerAddr(o))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [ens]);

  const load = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const r = await peekAnimaFE(ens);
      if (!r) {
        setState({ kind: "absent" });
        return;
      }
      setState({
        kind: "encrypted",
        peek: {
          root: r.root,
          ownerAddr: r.doc.ownerAddr,
          ownerPubkey: r.doc.ownerPubkey,
          ciphertext: r.doc.ciphertext,
          nonce: r.doc.nonce,
          createdAt: r.doc.createdAt,
        },
      });
    } catch (err) {
      setState({ kind: "error", message: (err as Error).message });
    }
  }, [ens]);

  useEffect(() => {
    load();
  }, [load]);

  // "Can edit / publish" is governed by the ENS resolver: setText reverts
  // if the caller isn't the on-chain owner of the subname. So gate on
  // ENS ownership, regardless of any in-doc ownerAddr.
  const isEnsOwner =
    !!address &&
    !!ensOwnerAddr &&
    address.toLowerCase() === ensOwnerAddr.toLowerCase();

  // "Can decrypt" is about whose secret encrypted the content — check
  // against the doc's ownerAddr (which equals the wallet that signed the
  // doc, which derived the X25519 keys). Distinct from ENS ownership
  // because in theory the two can drift after a transfer.
  const isDocOwner =
    (state.kind === "encrypted" || state.kind === "decrypted") &&
    !!address &&
    state.peek.ownerAddr.toLowerCase() === address.toLowerCase();

  async function decrypt() {
    if (!walletClient || !address) return;
    if (state.kind !== "encrypted") return;
    setBusy("decrypt");
    setDecryptError(null);
    try {
      const keys = await deriveAgentKeypair(
        walletClient,
        address,
        ens,
        knownVersion,
      );
      // Sanity: the derived pubkey must match the doc's pubkey.
      if (keys.pubkey !== state.peek.ownerPubkey) {
        throw new Error(
          "derived pubkey doesn't match the published owner pubkey — " +
            "are you connected with the wallet that owns this agent?",
        );
      }
      const content = decryptMessage(
        state.peek.ciphertext,
        state.peek.nonce,
        state.peek.ownerPubkey,
        keys.secretKey,
      );
      setState({ kind: "decrypted", peek: state.peek, content });
    } catch (err) {
      setDecryptError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function save() {
    if (!walletClient || !address) return;
    setBusy("publish");
    setError(null);
    try {
      // Re-derive the agent keypair so we encrypt to the same pubkey
      // every time. Same wallet+ens → same keys.
      const keys = await deriveAgentKeypair(
        walletClient,
        address,
        ens,
        knownVersion,
      );
      await publishAnima({
        ens,
        ownerAddr: address,
        ownerPubkey: keys.pubkey,
        ownerSecretKey: keys.secretKey,
        content: draft,
        walletClient,
      });
      setEditing(false);
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel-neon-flux p-4">
      <div className="flex items-center justify-between mb-3">
        <p className="eyebrow text-flux-300">Anima — soul of the agent</p>
        {(state.kind === "encrypted" || state.kind === "decrypted") && (
          <span className="text-[10px] font-mono text-gray-500 truncate max-w-[160px]">
            root · {state.peek.root.slice(0, 12)}…
          </span>
        )}
      </div>

      {state.kind === "loading" && (
        <p className="text-xs font-mono text-gray-500">Resolving anima…</p>
      )}

      {state.kind === "error" && (
        <p className="text-xs text-red-400 whitespace-pre-wrap">
          {state.message}
        </p>
      )}

      {state.kind === "absent" && !editing && (
        <div>
          <p className="text-xs text-gray-500 mb-3">
            No anima published for this agent. The owner of the ENS subname
            can publish one (encrypted to the agent's own pubkey) to give
            the agent grounding context that ships with every reply.
          </p>
          {isEnsOwner && !!walletClient ? (
            <button
              onClick={() => {
                setDraft("");
                setEditing(true);
              }}
              className="btn-neon !px-3 !py-1.5 !text-[11px]"
            >
              + Publish anima
            </button>
          ) : (
            <p className="text-[11px] text-gray-500 italic">
              {!address
                ? "Connect a wallet to publish."
                : ensOwnerAddr
                  ? `only the ENS owner (${ensOwnerAddr.slice(0, 10)}…${ensOwnerAddr.slice(-4)}) can publish`
                  : "checking ENS ownership…"}
            </p>
          )}
        </div>
      )}

      {state.kind === "encrypted" && !editing && (
        <>
          <div className="rounded-md border border-flux-700/40 bg-ink-950/80 p-3 font-mono text-xs text-flux-200/70 break-all">
            <span className="text-flux-400">[encrypted ciphertext —</span>{" "}
            only the agent's owner / runtime can decrypt
            <span className="text-flux-400">]</span>
          </div>
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            {isDocOwner ? (
              <button
                onClick={decrypt}
                disabled={busy === "decrypt"}
                className="btn-neon !px-3 !py-1.5 !text-[11px]"
              >
                {busy === "decrypt" ? "Deriving & decrypting…" : "🔓 Decrypt"}
              </button>
            ) : (
              <span className="text-[11px] text-gray-500 italic">
                only the agent's owner ({state.peek.ownerAddr.slice(0, 10)}…
                {state.peek.ownerAddr.slice(-4)}) can decrypt
              </span>
            )}
            {decryptError && (
              <span className="text-xs text-red-400">{decryptError}</span>
            )}
          </div>
          <div className="mt-3 pt-3 border-t border-flux-900/40 flex items-center justify-between text-[11px] font-mono text-gray-500">
            <span>
              owner · {state.peek.ownerAddr.slice(0, 10)}…
              {state.peek.ownerAddr.slice(-4)}
            </span>
            <span>
              published{" "}
              {new Date(state.peek.createdAt * 1000).toLocaleString()}
            </span>
          </div>
        </>
      )}

      {state.kind === "decrypted" && !editing && (
        <>
          <pre className="whitespace-pre-wrap text-sm text-gray-100 font-sans leading-relaxed max-h-64 overflow-y-auto">
            {state.content}
          </pre>
          <div className="mt-3 pt-3 border-t border-flux-900/40 flex items-center justify-between text-[11px] font-mono text-gray-500">
            <span>
              owner · {state.peek.ownerAddr.slice(0, 10)}…
              {state.peek.ownerAddr.slice(-4)}
            </span>
            <span>
              published{" "}
              {new Date(state.peek.createdAt * 1000).toLocaleString()}
            </span>
          </div>
          {isEnsOwner && isDocOwner && (
            <button
              onClick={() => {
                setDraft(state.content);
                setEditing(true);
              }}
              className="btn-ghost-neon !px-3 !py-1.5 !text-[11px] mt-3"
            >
              Edit anima
            </button>
          )}
        </>
      )}

      {editing && (
        <>
          <textarea
            className="w-full rounded-lg border border-flux-700/40 bg-ink-900/80 p-3 text-sm text-gray-200 font-mono resize-y focus:border-flux-400 focus:shadow-neon-flux focus:outline-none disabled:opacity-50 transition-all"
            rows={10}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Markdown content. Will be encrypted with the agent's own X25519 keypair before upload."
            disabled={busy === "publish"}
          />
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <button
              onClick={save}
              disabled={busy === "publish" || !draft.trim()}
              className="btn-neon !px-4 !py-1.5 !text-[11px]"
            >
              {busy === "publish" ? "Encrypting & publishing…" : "Encrypt, sign & publish"}
            </button>
            <button
              onClick={() => {
                setEditing(false);
                setError(null);
              }}
              disabled={busy === "publish"}
              className="text-xs text-gray-500 hover:text-gray-300"
            >
              Cancel
            </button>
            {error && <span className="text-xs text-red-400">{error}</span>}
          </div>
          <p className="mt-2 text-[11px] font-mono text-gray-500">
            box(content, agent_pubkey, agent_secret) · 1 wallet sig (sign
            doc) · 1 0G upload · 1 Sepolia tx (setText). Rejects if you
            don't own this ENS subname.
          </p>
        </>
      )}
    </div>
  );
}
