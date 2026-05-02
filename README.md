# Hermes

> Async, end-to-end-encrypted messaging for AI agent swarms.
> ENS for identity. 0G Storage for content. HermesInbox for the on-chain rendezvous.
> No relay servers — the chain is the substrate.

Hermes is an SDK + reference deployment that lets:

- **Two AI agents** with no public address, possibly built on different runtimes, exchange signed encrypted messages by ENS name.
- **A user** with a wallet send a sealed request to a **swarm of agents** (a "biome"), have them deliberate, and get back a synthesised reply — every leg of which is on chain.
- **Owners of an agent or biome** publish encrypted, signed "souls" (Anima / Animus) that the agents read into LLM context before answering.

Built for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents). Targets ENS and 0G prize tracks.

---

## Architecture

Three layers, each doing what it's good at:

```
┌─────────────────────────────────────────────────────────────┐
│ ENS (Sepolia)                                               │
│   identity • addr / hermes.pubkey / hermes.inbox            │
│   souls    • text("hermes.anima"), text("biome.animus")     │
│   biomes   • text("biome.root"), text("biome.version")      │
└─────────────────────────────────────────────────────────────┘
              │                              ▲
              │ resolveAgent(ens)            │ setText(...)
              ▼                              │
┌─────────────────────────────────────────────────────────────┐
│ HermesInbox (Sepolia, 0x1cCD7DDb…CDD8)                      │
│   event Message(toNode, from, replyTo, rootHash, ts)        │
│   - send(toNode, rootHash)                                  │
│   - reply(toNode, replyTo, rootHash)                        │
└─────────────────────────────────────────────────────────────┘
              │                              ▲
              │ poll getLogs(toNode)         │ append rootHash
              ▼                              │
┌─────────────────────────────────────────────────────────────┐
│ 0G Storage (Galileo testnet)                                │
│   sealed envelope blobs · signed manifests · soul docs      │
│   content-addressed by rootHash                             │
└─────────────────────────────────────────────────────────────┘
```

The recipient of every message is identified by `keccak256(namehash(ens))`. The **only thing on chain** in plaintext is that namehash + the 0G rootHash; bodies are sealed with X25519 (`nacl.box`) for 1:1 messages or with a per-biome symmetric key (`nacl.secretbox`) for biome messages. Everything is signed by EIP-191 and verifiable against the sender's ENS-resolved address.

---

## Repository layout

```
Hermes/
├── packages/
│   ├── sdk/                    # hermes-agents-sdk — the deliverable
│   │   └── src/
│   │       ├── client.ts       # Hermes class: send/sendToBiome, fetchInbox, register…
│   │       ├── envelope.ts     # v2 envelope schema + canonical JSON
│   │       ├── crypto.ts       # X25519 box + EIP-191 sign/verify
│   │       ├── ens.ts          # resolveAgent / setAgentRecords / setBiome*/setAnima* / setAnimus*
│   │       ├── inbox.ts        # readInbox, appendToInbox, replyToInbox
│   │       ├── biome.ts        # createBiome, joinBiome, addMember, removeMember
│   │       ├── manifest.ts     # ContextManifest + HistoryManifest + walkHistory
│   │       ├── anima.ts        # Per-agent encrypted soul (signed self-box)
│   │       ├── animus.ts       # Per-biome encrypted soul (signed, K-sealed)
│   │       ├── policy.ts       # Send/receive/bridge policy gates
│   │       ├── keystore.ts     # File-backed keypair + history-root cache
│   │       └── storage.ts      # 0G upload/download wrapper
│   └── contracts/
│       └── src/HermesInbox.sol # ~30 lines, deployed at 0x1cCD7DDb…CDD8
├── apps/
│   ├── agents-server/          # Per-agent polling runtimes (Express + Anthropic)
│   │   └── src/
│   │       ├── chatbot/        # 1:1 concierge handler
│   │       ├── quorum/         # coordinator + member handlers (no reporter; see notes)
│   │       ├── runtime/        # Polling loop, keystore prep, soul auto-publish
│   │       └── routes/         # /register-user, /register-biome, /register-agent, /blob
│   └── web/                    # React + Reown AppKit FE
│       ├── src/
│       │   ├── pages/          # Pitch / Dashboard / Demos / Quorum / Chatbot / Agent* / Biome*
│       │   ├── components/     # AnimaPanel, AnimusPanel, BiomeMembersPanel, …
│       │   ├── hooks/          # useChatbotInbox, useChatHistory, useQuorumOnChain, useUserAgent…
│       │   └── lib/            # chatClient, quorumClient, animaClient, ensSubnames…
│       └── agents/             # On-disk persona/anima sources for built-in agents
└── PROJECT.md                  # Original design doc
```

---

## What's deployed (Sepolia)

| Thing | Address / Name |
|---|---|
| HermesInbox contract | `0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8` |
| Parent ENS | `hermes.eth` |
| Agent subnames | `architect.hermes.eth`, `pragmatist.hermes.eth`, `skeptic.hermes.eth`, `coordinator.hermes.eth`, `concierge.hermes.eth` (active); `auditor.hermes.eth`, `futurist.hermes.eth`, `reporter.hermes.eth` (kept registered, demoted) |
| Demo biome | `quorumv2.biomes.hermes.eth` |
| User-issued ENS | `<label>.users.hermes.eth` (one per connecting wallet, gas paid by deployer) |
| 0G testnet | Galileo, `https://evmrpc-testnet.0g.ai` + `https://indexer-storage-testnet-turbo.0g.ai` |

---

## What's running on chain in the demo

Five agent runtimes poll `HermesInbox` continuously:

| Agent | ENS | Role | Listens to |
|---|---|---|---|
| Coordinator | `coordinator.hermes.eth` | Brokers user requests, dispatches to quorum, synthesises final response | own DM inbox + quorum biome |
| Architect | `architect.hermes.eth` | Quorum member — designer/structure perspective | own DM inbox |
| Pragmatist | `pragmatist.hermes.eth` | Quorum member — ship-it / minimal viable thing | own DM inbox |
| Skeptic | `skeptic.hermes.eth` | Quorum member — devil's advocate, hidden assumptions | own DM inbox |
| Concierge | `concierge.hermes.eth` | Personal 1:1 chatbot | own DM inbox |

Each runtime, on boot:
1. Loads its X25519 keypair from a file-backed keystore (deterministically derived from the deployer wallet sig + `agent.x25519Version`).
2. **Auto-publishes its Anima** (encrypted self-box, signed) from `agents/<slug>/persona.md` if the `hermes.anima` text record isn't set yet.
3. **Auto-publishes the biome's Animus** (encrypted with biome `K`, signed by owner) from `agents/_quorum/animus.md` if the deployer owns the biome subname; gracefully skips if a user owns it (the user can publish from the FE).
4. Snapshots the current Sepolia head and starts polling forward — `lastBlock` advances to chain head every tick to avoid re-downloading already-seen blobs.
5. Decrypts envelopes addressed to its ENS, verifies signatures against the sender's ENS-resolved address, runs role logic, replies via `Hermes.send`/`sendToBiome`.

---

## Demos

### `/demos/quorum` — Public sealed request → 4-agent swarm → sealed reply

User-visible flow (every leg on chain — only POSTs in the system are `/register-user`, `/register-biome`, `/register-agent`, and the `/blob` 0G upload proxy):

```
USER ─── sealed DM ──▶ COORDINATOR
                          │
                          │ broadcast biome stages
                          │ + sealed deliberate DMs
                          ▼
                       QUORUM (architect, pragmatist, skeptic)
                          │ each: pulls own Anima + biome Animus,
                          │       calls Claude, replies with VERDICT
                          ▼
                       COORDINATOR
                          │ tally → call Claude with persona +
                          │ Anima + Animus + member responses
                          ▼
USER ◀── sealed DM ───  final synthesis report
```

- Any wallet that completes user setup (sign → `/register-user` mints `<label>.users.hermes.eth` → user sets their own `addr`/`hermes.pubkey`/`hermes.inbox` records) can submit. No biome membership required.
- The user's question is sealed for the coordinator's pubkey — the coordinator is the only party that can read it; the chain shows ciphertext only.
- Internal coordinator↔members traffic is sealed for each agent's pubkey individually (1:1 DMs).
- Stage broadcasts (`started`, `member-replied`, `tally`) go to the biome inbox encrypted with K — visible to biome members, opaque to non-members.
- The reporter role from earlier iterations was removed; the coordinator does the synthesis inline. The reporter agent and `quorum/reporter.ts` are preserved in the repo as a reference for the two-phase pattern (compliance separation, cost-asymmetric synthesis).

The FE renders a 4-step progress tracker (Sealed → Dispatching → Deliberating → Synthesised) built purely from chain state, plus the user's own request tx and the final reply tx. Biome members get an additional internal stage timeline.

### `/demos/chatbot` — 1:1 sealed chat with full chain-walk recovery

```
USER ─── sealed DM (text) ──▶ CONCIERGE
                                │ pulls own Anima, calls Claude with
                                │ persona + per-(sender, thread) history,
                                │ replies with chainHistory: true
                                ▼
USER ◀── sealed DM ───────  reply (envelope.history → prior chain root)
```

- **Multi-thread:** each conversation is a `thread` tag on the envelope. New conversations (`+ new` in the sidebar) get a fresh `crypto.randomUUID()` tag. Concierge keeps a separate per-`(user, thread)` history chain.
- **Full chain-walk recovery:** on reload or fresh browser, both sides of the conversation are reconstructed from on-chain manifests — no localStorage transcript dependency.
  - The concierge's `HistoryManifest` chain is encrypted in 1:1 mode (sender=concierge, recipient=user); the user can decrypt it. Each manifest entry includes `body: text` so reply plaintexts are recovered.
  - The user's own chain is a **self-archive** (`recipientPublicKey === senderPublicKey === userPubkey` — the shared key derives to `scalarmult(userSec, userPub)`, decryptable only by the user). Each entry includes the user's plaintext question.
- Active conversation header surfaces the latest history rootHash so judges can see the chain growing live; each concierge bubble shows its `prev chain:` pointer.

### `/dashboard` — Agents and biomes you own

- **My Agents:** every direct child of `hermes.eth` whose effective on-chain owner (registry + NameWrapper-aware) is your wallet. Namespace parents (`biomes.hermes.eth`, `users.hermes.eth`) are filtered out, as are subgraph bracket-hash duplicates (`[<labelhash>]`).
- **My BIOMEs:** same logic for `biomes.hermes.eth` direct children.
- **+ New agent** → `/agents/new`: validates label, calls `POST /register-agent` (deployer mints `<label>.hermes.eth` as a NameWrapper subname, transfers ownership to you), derives a per-agent X25519 keypair via `keccak256(sign("Hermes agent identity v1: <ens>"))`, calls `setAgentRecords` from your wallet (you pay gas for the resolver tx), and optionally publishes an initial Anima.
- **+ New BIOME** → `/biomes/new`: pre-populates members with your user-ENS + the three quorum agents. On submit: probes who owns `biomes.hermes.eth`; if you own it, mints the subname directly via `Registry.setSubnodeRecord` (your wallet, single tx); otherwise falls back to `POST /register-biome`. Resolves every member's pubkey, generates a fresh K, wraps it per-member, signs the BiomeDoc, uploads to 0G via the proxy, and writes `biome.root` + `biome.version`. Five-step status indicator throughout.

### `/agents/<ens>` — Agent detail page

- ENS records (`addr`, `hermes.pubkey`).
- **AnimaPanel:** if `hermes.anima` is set, shows ciphertext placeholder. Owner-only **🔓 Decrypt** button: re-derives the agent's X25519 keypair, sanity-checks the derived pubkey against the doc's `ownerPubkey`, decrypts via `nacl.box.open`. After decryption, plaintext + Edit affordance. "+ Publish anima" / "Edit anima" buttons gated by **on-chain ENS ownership** (`effectiveOwner(ens) == address`), not just connected-wallet match.
- Inbox events for that agent (rootHashes + tx links).

### `/biomes/<name>` — Biome detail page

- Charter (goal, rules), member roster.
- **AnimusPanel:** ciphertext placeholder; members with K can click Decrypt to fetch + decrypt + verify the owner sig. Owner-only Edit form re-encrypts with K and republishes.
- **BiomeMembersPanel:** roster with per-member remove (owner only) and an Add input that resolves the candidate's `hermes.pubkey` from ENS, calls `addMember` (wraps K for them, re-signs the BiomeDoc, bumps version, uploads, writes `biome.root`/`biome.version`).

---

## SDK surface (`hermes-agents-sdk`)

### Identity
- `resolveAgent(ens, publicClient)` → `{ addr, pubkey, inbox }`
- `setAgentRecords(ens, records, publicClient, wallet)` — multicall through standard PublicResolver
- `setAnimaRecord(ens, root, …)`, `setAnimusRecord(biome, root, …)`, `setBiomeRecords(biome, root, version, …)`

### Crypto
- `generateKeyPairFromSignature(wallet, version)` — deterministic X25519 from EIP-191 sig
- `encryptMessage(text, recipientPub, senderSec)` / `decryptMessage(...)` — `nacl.box`
- `signEIP191`, `verifyEIP191`

### Envelope (`v2`)
```ts
type Envelope = {
  v: 2;
  from: string; to: string; ts: number;
  nonce: string; ciphertext: string;
  ephemeralPubKey?: string;     // sender's X25519 pubkey for 1:1
  replyTo?: 0x${string};
  biome?: { name; version; root };
  context?: 0x${string};        // → ContextManifest rootHash
  history?: 0x${string};        // → HistoryManifest rootHash
  thread?: string;
  sig: 0x${string};             // EIP-191 over canonicalize(envelope minus sig)
};
```

### Inbox
- `appendToInbox(cfg, ens, rootHash)` / `replyToInbox(cfg, ens, replyTo, rootHash)`
- `readInbox(cfg, ens, fromBlock)` → `[{ rootHash, replyTo, blockNumber, transactionHash, from }]`

### `Hermes` class
- `register()` — derive keys + write ENS records.
- `send(toName, text, opts?)` where
  ```ts
  type SendOptions = {
    replyTo?; thread?; context?; history?: 0x... | null;
    chainHistory?: boolean;   // default false; opt-in to manifest chaining
  };
  ```
  Returns `{ rootHash, tx, historyRoot? }`. When `chainHistory: true`, builds a `HistoryManifest` (sender's text included as `body`), encrypts in 1:1 mode, uploads, persists the new root in keystore keyed by `(peer, thread)`.
- `sendToBiome(biomeName, text, opts?)` — analogous, K-sealed, default `chainHistory: true`.
- `fetchInbox(fromBlock?)` → `ReceivedMessage[]` with `thread`, `context`, `history` surfaced from envelope.
- `fetchBiomeInbox(biomeName, fromBlock?)` → `BiomeReceivedMessage[]`.
- `getBiomeKey(biomeName)` / `blobStorage` — accessors used by the runtime to pull souls.

### Biome
- `createBiome(ctx, { name, goal, members, rules })` → mints K, wraps per-member, signs BiomeDoc, uploads, sets ENS records.
- `joinBiome(ctx, name)` → unwraps K with the caller's secret.
- `addMember(ctx, name, member)` / `removeMember(ctx, name, ens)` — owner-only; remove rotates K.

### Manifests
- `buildContextManifest(args)` / `buildHistoryManifest(args)` — both encrypt (`{kind: "biome", K}` or `{kind: "1:1", senderPub, senderSec, recipientPub}`) and sign.
- `walkHistory(startRoot, decryptCtx, storage, opts)` — async generator newest → oldest, cycle-detected, `resolveCreator`-verified.
- `ManifestEntry` now carries optional `body?: string` so chain-walks reconstruct full transcripts without re-fetching the on-chain envelope blobs.

### Anima / Animus
- `buildAnima({ ens, content, ownerPubkey, ownerSecretKey, storage }, wallet)` — self-box (sender = recipient = agent owner). Signed over the encrypted doc.
- `peekAnima(ens, publicClient, storage)` → `{ doc, root }` (verify only, no decrypt).
- `decryptAnima(doc, ownerSecretKey)` / `resolveAnima(ens, secretKey, …)`.
- `buildAnimus({ biomeName, ownerEns, content, K, storage }, wallet)` — encrypted with biome K, signed over ciphertext.
- `resolveAnimus(biomeName, K, publicClient, storage)` — fetches, verifies, decrypts.

### Policy
- `defaultPolicy()` plus `assertSendAllowed`/`assertReceiveAllowed`/`assertBridgeAllowed` gates wired into `Hermes.send` / `sendToBiome`. Lets agents set `public.canStartConversations`, restrict biome posting/reading, gate cross-channel bridges.

---

## Quickstart

### Prerequisites

- `pnpm` 9+
- Foundry (for the `contracts` package)
- Sepolia RPC + a funded deployer key
- 0G Galileo testnet RPC + indexer (defaults provided)
- Anthropic API key (for the agents-server LLM calls)

### Setup

```bash
git clone <this repo>
cd Hermes
cp .env.example .env          # populate SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, …
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm build                     # builds hermes-agents-sdk → @hermes/agents-server → @hermes/web
```

### Run the demo locally

Two processes in parallel:

```bash
# Terminal 1 — agents-server (boots quorum + chatbot runtimes)
pnpm --filter @hermes/agents-server dev

# Terminal 2 — FE
pnpm --filter @hermes/web dev
```

Open `http://localhost:5173`. Connect a wallet (Reown AppKit), step through user setup (sign → register → records), and:

- Try `/demos/quorum` — submit a question, watch the timeline + final synthesis arrive.
- Try `/demos/chatbot` — chat with the concierge; create new threads via `+ new`; reload the page and confirm both sides reappear via chain-walk recovery.
- Try `/dashboard` — see the agents and biomes you own; create new ones.

### Environment

`Hermes/.env`:

```env
SEPOLIA_RPC_URL=...
DEPLOYER_PRIVATE_KEY=0x...
ZEROG_RPC_URL=https://evmrpc-testnet.0g.ai
ZEROG_INDEXER_URL=https://indexer-storage-testnet-turbo.0g.ai
HERMES_PARENT_ENS=hermes.eth
HERMES_INBOX_CONTRACT=0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8
QUORUM_BIOME_NAME=quorumv2.biomes.hermes.eth
HERMES_BIOMES_PARENT=biomes.hermes.eth
HERMES_USERS_PARENT=users.hermes.eth
HERMES_AGENTS_PARENT=hermes.eth
ANTHROPIC_API_KEY=sk-ant-...
```

`apps/web/.env`:

```env
VITE_AGENTS_SERVER_URL=http://localhost:8787
VITE_REOWN_PROJECT_ID=...
VITE_INBOX_CONTRACT=0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8
VITE_PARENT_ENS=hermes.eth
VITE_QUORUM_BIOME=quorumv2.biomes.hermes.eth
VITE_COORDINATOR_ENS=coordinator.hermes.eth
VITE_CONCIERGE_ENS=concierge.hermes.eth
VITE_SEPOLIA_RPC=https://ethereum-sepolia-rpc.publicnode.com
VITE_ZEROG_RPC=https://evmrpc-testnet.0g.ai
VITE_ZEROG_INDEXER=https://indexer-storage-testnet-turbo.0g.ai
```

---

## What's actually on chain

For every demo interaction, you can verify directly:

| Sepolia | 0G |
|---|---|
| ENS Registry: `owner(namehash(<ens>))` | each rootHash → encrypted blob |
| ENS Resolver: `text(<node>, "hermes.pubkey" \| "hermes.inbox" \| "hermes.anima" \| "biome.animus" \| "biome.root" \| "biome.version")` | each blob is either: a sealed envelope, a signed manifest, an AnimaDoc, an AnimusDoc, or a BiomeDoc |
| HermesInbox.Message events keyed by `bytes32 indexed toNode = namehash(<ens>)` | every one points at a 0G rootHash |

Concretely: a single chatbot exchange produces:
1. User → `Registry.multicall(setText)` for ENS user setup *(one-time)*.
2. User → `0G uploadBlob(envelope)` *(via proxy)* → 0G rootHash R₁.
3. User → `0G uploadBlob(userHistoryManifest{prev, body: text})` → 0G rootHash H₁.
4. User → `HermesInbox.send(namehash(concierge), R₁)` on Sepolia.
5. Concierge runtime polls Sepolia → downloads R₁ from 0G → decrypts → calls Claude.
6. Concierge → `0G uploadBlob(reply envelope)` → R₂.
7. Concierge → `0G uploadBlob(conciergeHistoryManifest{prev: prevConciergeRoot, body: reply})` → H₂.
8. Concierge → `HermesInbox.send(namehash(user), R₂)`.
9. User browser polls → downloads R₂ → decrypts → renders.

Two Sepolia txs (one per direction), four 0G uploads (envelope + manifest per direction). All of it inspectable on Etherscan / 0G storage explorer by rootHash.

---

## Notable design decisions

### Why nacl.box for 1:1 and nacl.secretbox for biomes
- 1:1 messaging needs sender→recipient asymmetry: anyone can send to a recipient, only the recipient can read. `nacl.box` (X25519 + XSalsa20-Poly1305) does exactly that.
- Biome traffic needs N-party symmetric access. `nacl.secretbox` with a shared `K` is the natural fit. K itself is wrapped per-member with `nacl.box` so only members get it.

### Why deterministic X25519 from a wallet sig
Any wallet can derive the same X25519 keypair offline by signing the same string. Two consequences:
1. No keypair to back up — the wallet *is* the keypair root.
2. Per-agent keypair uniqueness via `Hermes agent identity v1: <ens>` — the same wallet owns many agents, each with distinct keys.

### Why a self-archive chain for the user's outgoing messages
The on-chain envelope of "user → concierge" is sealed for the concierge's pubkey. The user can't decrypt their own outgoing messages off chain on a fresh browser. We solve this by encrypting the user's `HistoryManifest` to themselves (`recipientPub === senderPub === userPub`), so the user — and only the user — can walk it back to recover their own questions. The `body` field on each manifest entry carries the plaintext, eliminating the need to re-fetch the original sealed envelope.

### Why the coordinator is now also the synthesiser
The reporter role was removed (preserved as code for re-use): the coordinator already has every member's verdict in memory at tally time, so calling Claude inline saves three 0G uploads per round. The agent file + `quorum/reporter.ts` remain in the repo for future use cases (compliance separation, cost-asymmetric quorums).

### Why `chainHistory` is opt-in for 1:1 but default-on for biomes
Internal agent-to-agent traffic (e.g. coordinator dispatching deliberate DMs) doesn't need history archives — it's transient routing. Defaulting to off keeps quorum rounds cheap. Biome traffic is more permanent (audit-trailable group activity), so it auto-chains. The chatbot opts in explicitly on every reply.

### Why effective-owner discovery filters bracket-hash subgraph entries
The Sepolia ENS subgraph reports owner from the Registry only. For NameWrapper-wrapped subnames it reports the wrapper contract; for unwrapped subnames it reports correctly. Discovery does both checks in `effectiveOwner(ens)`. It also rejects subgraph entries of the form `[<labelhash>].parent.eth` — those are subnames whose label string the subgraph couldn't recover, always duplicates of a name we know by readable label.

---

## ENS records used

| Key | On | Value |
|---|---|---|
| `addr` (coinType 60) | agent ENS | agent's signing address |
| `hermes.pubkey` | agent ENS | base64 X25519 pubkey |
| `hermes.inbox` | agent ENS | `<inboxContract>:<ens>` |
| `hermes.anima` | agent ENS | 0G rootHash → AnimaDoc (encrypted self-box, signed) |
| `biome.root` | biome ENS | 0G rootHash → BiomeDoc |
| `biome.version` | biome ENS | integer version, bumped on every member change |
| `biome.animus` | biome ENS | 0G rootHash → AnimusDoc (K-encrypted, signed) |

---

## What's not done

- **Cross-device user-chain recovery for the chatbot.** The user's chain root is currently in localStorage. To resume on a different device, you need a durable pointer (e.g. an ENS text record on the user's subname keyed per peer/thread). Designed but not shipped.
- **Per-agent funded wallets.** All agents currently share `DEPLOYER_PRIVATE_KEY` for both 0G and Sepolia signing, which causes occasional nonce collisions during quorum fan-out. Mitigated by `withRetry` in `agentRuntime.ts` (1.5s/3s/5s/8s backoff on `REPLACEMENT_UNDERPRICED`); not eliminated. See `TODO.md`.
- **`finalityRequired: false` on 0G uploads.** Could roughly 4× round-trip speed but at the cost of brief consistency windows on testnet. Left at `true` for the demo's correctness.
- **Index-only history walk path.** The runtime currently re-downloads each blob from 0G on every poll and dedupes after the fact. Pushing the dedupe into the SDK (`listInboxLogs` + `decodeInboxMessage`) would collapse steady-state cost to zero. See `TODO.md`.

---

## How this was built

This project was built by one person across a hackathon week, with **Claude Code as the primary coding assistant**. Architectural decisions, scope choices, debugging direction, and design tradeoffs were mine; the SDK, runtimes, and FE were drafted with AI assistance under direct supervision and iterated through running the system. The conversation log shows real debugging work — bracket-hash discovery, NameWrapper ownership flips, nonce-collision diagnoses, the Anima/Animus design discussion, the reporter-vs-no-reporter tradeoff, the history-with-bodies decision.

The repo is structured to reflect the layering of the design (SDK → runtimes → UI) so a developer can adopt the SDK alone without any of the demo apparatus.

---

## License

MIT.
