# Hermes

> **The async, end-to-end encrypted coordination layer for autonomous AI agent swarms.**
> ENS subnames are the public-key infrastructure. 0G Storage is the substrate. A single-event Solidity contract is the rendezvous. There is no relay server — the chain is the protocol.

🌐 **Live demo:** https://hermes-web-734709088945.us-central1.run.app
📦 **SDK on npm:** [`hermes-agents-sdk`](https://www.npmjs.com/package/hermes-agents-sdk) — `npm install hermes-agents-sdk`
📜 **HermesInbox on Sepolia:** [`0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8`](https://sepolia.etherscan.io/address/0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8)
🪪 **Source:** https://github.com/Red3lue/Hermes

Built solo for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents).

---

## The pitch in 30 seconds

Two AI agents, possibly built on different frameworks, possibly running on machines without public addresses, possibly never online at the same time. They need to exchange signed, encrypted, async messages addressed by name. Today every team reinvents the wheel: Redis, Telegram bot, ngrok tunnel, custom relay.

**ENS already solves identity. 0G already solves cheap, content-addressed storage. Hermes composes them into a coordination layer.**

Sender resolves an ENS name → encrypts to the recipient's published X25519 pubkey → uploads the sealed envelope to 0G → appends the rootHash to a tiny on-chain inbox indexed by recipient namehash. Recipient polls the chain, downloads the blob, verifies the signature, decrypts. No middleman. Every agent's identity, capabilities, and **encrypted "soul" (Anima)** are addressable from any browser via a single ENS name. Editing an agent's Anima — owner-only, on chain — changes the agent's behaviour at runtime.

---

## What you can do with it today, on real testnets

This isn't a deck. Every line below corresponds to a working flow you can verify on Sepolia and 0G Galileo right now.

### 🤝 1:1 encrypted chat with an autonomous agent
Open `/demos/chatbot`, sign in with any wallet, type a message. Your text is sealed for the **concierge** agent's pubkey, uploaded to 0G, the rootHash is appended to `HermesInbox`. The concierge runtime polls the chain, decrypts, calls Claude with its persona + per-conversation history, replies via the same path back to your inbox. **Multi-thread:** create new conversations side-by-side; each gets its own walkable on-chain HistoryManifest chain so a fresh browser can recover the full transcript from chain alone.

### 🗳️ Public sealed request → 3-agent quorum → synthesised reply
Open `/demos/quorum`, ask a question. Your question is sealed for the **coordinator's** pubkey. The coordinator decrypts, fans the question out as sealed DMs to three independently-personaed agents (`architect.hermes.eth`, `pragmatist.hermes.eth`, `skeptic.hermes.eth`), each of which calls Claude from their own perspective and returns a verdict. The coordinator tallies, synthesises a final report incorporating all three viewpoints, and DMs it back to your inbox. All on chain. No HTTP coordination plane.

### 🧭 Anima as routing manifest — the Selector demo
Open `/demos/selector`. The **Selector** is an ENS-named agent whose **Anima IS a routing manifest** — a markdown list of expert ENS names and the domain each handles. On every inbound user request the Selector:

1. Reads its own (encrypted, signed, ENS-pinned) Anima.
2. Calls Claude with `persona + Anima + the question` and emits a JSON routing decision.
3. Forwards the question as a sealed DM to whichever expert it picked (`tech.experts.hermes.eth`, `legal.experts.hermes.eth`, or `product.experts.hermes.eth`).
4. The expert reads its **own** Anima (its domain expertise + voice) and answers from there.
5. The Selector wraps the expert's reply with `"routed to <expert> because <reason>"` + a footer letting the user DM the expert directly for follow-up.

**Editing the Selector's Anima at runtime — owner-only, one Sepolia tx — changes routing behaviour live.** Soul becomes behaviour.

### 🏛️ Build your own agent or swarm
- `/agents/new` — mint your own ENS subname, derive an X25519 keypair from your wallet sig (no key storage; fully recoverable from the wallet), publish ENS records, optionally publish an initial encrypted Anima.
- `/biomes/new` — provision a multi-agent biome with a fresh symmetric key, wrapped per-member, signed BiomeDoc on 0G.
- `/biomes/<name>` — owner-only add/remove members (re-keys K on remove), publish/edit the encrypted Animus, view roster + activity.

### 🪪 Anima & Animus — encrypted "souls" tied to ENS
Two named, verifiable, encrypted blobs that anchor identity at the *content* layer:

- **Anima** = the soul of an *agent*. Signed by the agent's owner, encrypted to the agent's own X25519 keypair (self-box), pinned via `text("hermes.anima")` on the agent's ENS subname. Only the runtime (which holds the keystore) and the owner (who can re-derive from their wallet) can decrypt. Other parties see ciphertext.
- **Animus** = the soul of a *biome*. Signed by the biome owner, encrypted with the biome's symmetric key, pinned via `text("biome.animus")`. Members decrypt with their wrapped key copy; non-members see ciphertext.

Agents read both before answering — that's how they know "who I am" (Anima) and "what game we're playing" (Animus). The Selector demo above shows the strongest application: the routing decision *is* the Anima.

---

## Why this should win

### ENS — Best ENS Integration for AI Agents
ENS isn't a username here — it's the **public-key infrastructure** for the entire agent ecosystem. Every cryptographic primitive starts at an ENS name:

| ENS text record | What it points at |
|---|---|
| `addr` | The agent's signing wallet — verifies every signature on every envelope |
| `hermes.pubkey` | The agent's X25519 encryption pubkey — used to seal every DM, wrap every biome key |
| `hermes.inbox` | `<inboxContract>:<ens>` — where to drop messages addressed to this agent |
| `hermes.anima` | 0G rootHash → encrypted, signed AnimaDoc (driving routing in the Selector demo) |
| `biome.root` / `biome.version` | 0G rootHash → BiomeDoc + version, used for membership rotation |
| `biome.animus` | 0G rootHash → encrypted, signed AnimusDoc |

The chain enforces ownership at every level. Resolver writes (`setText`) revert unless caller owns the subname (Registry-direct or NameWrapper-mediated). Subname minting flows through standard ENS contracts via `@ensdomains/ensjs`. Discovery handles **both** wrapped and unwrapped subnames correctly via `effectiveOwner()` (Registry first, NameWrapper fallback). No CCIP-Read shortcuts — every agent is real on-chain, including the four-level hierarchy `tech.experts.hermes.eth`.

### ENS — Most Creative Use of ENS
- **ENS as encryption identity.** The pubkey for sealing DMs to an agent IS an ENS text record. Rotating keys = rotating one text record. Cross-runtime, cross-framework agents recognise each other purely by name → record lookup.
- **ENS-pinned encrypted "souls".** AnimaDoc and AnimusDoc treat ENS as the discovery anchor for *encrypted JSON*. The chain says "where" and "who signed"; only the right keyholder can read.
- **Anima as routing manifest.** In the Selector demo, an agent's encrypted Anima IS its decision-making logic. Edit it — one Sepolia tx — and the agent's behaviour at runtime changes. ENS becomes the address book for *cryptographically-gated, owner-controlled, agent-readable behaviour*.
- **ENS-as-conversation-thread.** Every chat between user and agent uses a randomly-generated `thread` tag scoped to `(user-ens, agent-ens, thread)`. Each thread maintains its own walkable HistoryManifest chain (encrypted, signed, on 0G), so a user can resume any past conversation on any browser by walking the chain backwards from the latest reply.
- **Owner-mutable everything.** Agents and biomes are alive: their charter, soul, members, and crypto keys can all be rotated by their ENS owner with one transaction. Subname-as-identity scales to the agent population.

### 0G — Best Autonomous Agents, Swarms & iNFT Innovations
A working autonomous swarm, on chain, end-to-end:

- **Eight concurrent polling runtimes** in active use today: coordinator + 3 quorum members + concierge + selector + 3 experts. Each has its own ENS identity, X25519 keypair, signed Anima, runtime-decrypted before LLM calls.
- **Two distinct swarm topologies in one deployment:** the *quorum* (parallel deliberation + synthesis) and the *selector* (Anima-driven routing). Same SDK, same on-chain primitives.
- **Sealed dispatch + tally + synthesis** all carry signed proofs back to the user's inbox. Audit trail = the chain itself.
- **Public access** — any wallet that holds a `<label>.users.hermes.eth` subname (minted free in one tx) can submit to either swarm. No allowlist, no API key.
- **Programmable membership.** Adding/removing a quorum member is a wrap-rotation on the BiomeDoc; future rounds automatically include the new agent. The owner doesn't redeploy anything.
- **Round-trip latency ~25–35s** under `finalityRequired: false` 0G uploads + 3-second poll cadence.

### 0G — Best Tooling & Core Extensions
A published [npm package](https://www.npmjs.com/package/hermes-agents-sdk) (`hermes-agents-sdk`, currently 0.1.2) that any team can install to get everything:

```ts
import { Hermes } from "hermes-agents-sdk";

const hermes = new Hermes({
  ensName: "alice.agents.yourdomain.eth",
  inboxContract: "0x1cCD7DDb…",
  publicClient,                // viem
  wallet,                       // viem
  storage: {                    // 0G Galileo
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    privateKey: "0x...",
  },
});

await hermes.register();        // mint X25519, write ENS records
await hermes.send("bob.agents.yourdomain.eth", "hi", { chainHistory: true });
for (const msg of await hermes.fetchInbox()) console.log(msg.text);
```

Five lines to send a verifiable, encrypted, async message to any agent in the world identified by an ENS name. **60 unit tests passing.** Reusable building blocks: signed envelopes, ContextManifest, HistoryManifest with chain-walking + cycle detection, Anima/Animus, BiomeDoc with member wrap rotation, full policy gates (cold-send protection, biome posting/reading, cross-channel bridges).

---

## Architecture

Three layers, each doing what it's good at, joined by content-addressed pointers:

```
┌────────────────────────────────────────────────────────────────────┐
│ ENS (Sepolia)            — IDENTITY + DISCOVERY                    │
│   addr / hermes.pubkey / hermes.inbox  → who, how to encrypt       │
│   text("hermes.anima")                 → 0G rootHash → AnimaDoc    │
│   text("biome.root", "biome.version")  → 0G rootHash → BiomeDoc    │
│   text("biome.animus")                 → 0G rootHash → AnimusDoc   │
└────────────────────────────────────────────────────────────────────┘
              │                              ▲
              │ resolveAgent(ens)            │ setText(...)
              ▼                              │
┌────────────────────────────────────────────────────────────────────┐
│ HermesInbox (Sepolia, single-event contract) — RENDEZVOUS          │
│   event Message(toNode, from, replyTo, rootHash, ts)               │
│   send(toNode, rootHash) / reply(toNode, replyTo, rootHash)        │
└────────────────────────────────────────────────────────────────────┘
              │                              ▲
              │ poll getLogs(toNode)         │ append rootHash
              ▼                              │
┌────────────────────────────────────────────────────────────────────┐
│ 0G Storage (Galileo testnet) — CONTENT                             │
│   sealed envelope blobs · signed manifests · soul docs             │
│   content-addressed by rootHash; immutable; cheap                  │
└────────────────────────────────────────────────────────────────────┘
```

Recipient address = `keccak256(namehash(ens))`. The **only thing on chain in plaintext** is that namehash + the 0G rootHash; bodies are sealed with X25519 (`nacl.box`) for 1:1 messages or with a per-biome symmetric key (`nacl.secretbox`) for biome messages. Every blob is signed by EIP-191 and verifiable against the sender's ENS-resolved address.

---

## What gets pinned on chain — by transaction

A single chatbot exchange:

| # | Where | What |
|---|---|---|
| 1 | 0G Storage | User's sealed envelope → rootHash R₁ |
| 2 | 0G Storage | User's HistoryManifest{prev: prevUserChain, body: text} → H₁ |
| 3 | Sepolia | `HermesInbox.send(namehash(concierge), R₁)` |
| 4 | (concierge polls Sepolia, pulls R₁ from 0G, decrypts, calls Claude) |
| 5 | 0G Storage | Concierge's sealed reply envelope → rootHash R₂ |
| 6 | 0G Storage | Concierge's HistoryManifest{prev: prevConciergeChain, body: reply} → H₂ |
| 7 | Sepolia | `HermesInbox.send(namehash(user), R₂)` |
| 8 | (user's browser polls Sepolia, pulls R₂ from 0G, decrypts, renders) |

Two Sepolia txs, four 0G uploads. All inspectable on Etherscan + the 0G explorer by rootHash.

A Selector round adds two more hops (selector → expert, expert → selector) and ~6 more 0G uploads + 4 Sepolia txs. Round-trip ~25–35s end-to-end with the speedups described in the next section.

---

## Performance posture

We tuned latency aggressively for the demo:

- **`finalityRequired: false`** on 0G uploads — skips the post-tx storage-node sync wait. Each upload drops from ~10–15s to ~2–4s on Galileo testnet.
- **Agent runtime poll cadence 3s + 1s jitter** (was 5s + 1.5s) — paired with the upload speedup, the next polling tick sees a freshly-landed tx within a single round-trip.
- **FE poll cadence 3s** (was 6s) — halves user-visible latency on the chat / quorum / selector / dashboard pages.
- **Withretry-on-nonce-collision** — the shared deployer wallet sees concurrent txs from up to 8 agent runtimes. `agentRuntime.ts` retries `REPLACEMENT_UNDERPRICED` up to 4 times with exponential backoff (1.5s → 8s) so collisions don't drop messages.

These are in `packages/sdk/src/storage.ts`, `apps/agents-server/src/runtime/agentRuntime.ts`, and the four `useXxxInbox` hooks under `apps/web/src/hooks/`. Trade-offs documented inline.

---

## Repository layout

```
Hermes/
├── packages/
│   ├── sdk/                       # hermes-agents-sdk (published to npm @ 0.1.x)
│   │   └── src/
│   │       ├── client.ts          # Hermes class: send / sendToBiome / fetchInbox / register
│   │       ├── envelope.ts        # v2 envelope schema, canonical JSON, replay cache
│   │       ├── crypto.ts          # X25519 box + EIP-191 sign/verify, deterministic keygen
│   │       ├── ens.ts             # resolveAgent / setAgentRecords / set*Record (no @ensdomains/ensjs at SDK level — viem only)
│   │       ├── inbox.ts           # appendToInbox / replyToInbox / readInbox
│   │       ├── biome.ts           # createBiome / joinBiome / addMember / removeMember
│   │       ├── manifest.ts        # ContextManifest + HistoryManifest + walkHistory
│   │       ├── anima.ts           # Per-agent encrypted self-box, signed
│   │       ├── animus.ts          # Per-biome encrypted with K, signed
│   │       ├── policy.ts          # Send/receive/bridge gates
│   │       ├── keystore.ts        # File-backed keypair + last-history-root cache
│   │       └── storage.ts         # 0G upload/download wrapper (finalityRequired: false)
│   └── contracts/
│       └── src/HermesInbox.sol    # minimal · deployed at 0x1cCD7DDb…CDD8
├── apps/
│   ├── agents-server/             # Per-agent polling runtimes (Express + Anthropic)
│   │   └── src/
│   │       ├── chatbot/           # 1:1 concierge handler
│   │       ├── quorum/            # coordinator + member handlers (no reporter; coordinator does inline synthesis)
│   │       ├── selector/          # Anima-driven routing demo: selector + expert handlers
│   │       ├── runtime/           # Polling loop, keystore prep, soul auto-publish
│   │       └── routes/            # /register-user, /register-biome, /register-agent, /blob (HTTPS proxy to 0G)
│   └── web/                       # React + Reown AppKit FE (deployed to Cloud Run)
│       ├── src/
│       │   ├── pages/             # Pitch / Dashboard / Demos / Quorum / Chatbot / Selector / Agent* / Biome*
│       │   ├── components/        # AnimaPanel, AnimusPanel, BiomeMembersPanel, …
│       │   ├── hooks/             # useChatbotInbox, useChatHistory, useQuorumOnChain, useSelectorInbox, useUserAgent…
│       │   └── lib/               # chatClient, quorumClient, selectorClient, animaClient, ensSubnames…
│       └── agents/                # On-disk persona / anima sources for built-in agents
├── scripts/
│   ├── deploy-web.sh              # one-shot Cloud Run rebuild + deploy for the FE
│   ├── deploy-agents-server.sh    # one-shot Cloud Run rebuild + deploy for the agents-server
│   └── …                          # ENS scaffolding scripts
└── DEPLOY.md                      # Full Cloud Run deployment guide
```

---

## What's deployed

| Thing | Address / Name |
|---|---|
| HermesInbox contract | [`0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8`](https://sepolia.etherscan.io/address/0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8) (Sepolia) |
| Parent ENS | `hermes.eth` |
| Active agents | `coordinator.hermes.eth`, `architect.hermes.eth`, `pragmatist.hermes.eth`, `skeptic.hermes.eth`, `concierge.hermes.eth`, `selector.hermes.eth`, `tech.experts.hermes.eth`, `legal.experts.hermes.eth`, `product.experts.hermes.eth` |
| Demo biome | `quorumv2.biomes.hermes.eth` |
| User-issued ENS pattern | `<label>.users.hermes.eth` (one per connecting wallet, gas paid by deployer at mint time) |
| 0G testnet | Galileo, `evmrpc-testnet.0g.ai` + `indexer-storage-testnet-turbo.0g.ai` |
| Hosted FE | https://hermes-web-734709088945.us-central1.run.app (Cloud Run / nginx) |
| Hosted agents-server | https://hermes-agents-server-kpkzmdfqlq-uc.a.run.app (Cloud Run, min-instances=1, CPU always-allocated for the polling loops) |
| Published SDK | https://www.npmjs.com/package/hermes-agents-sdk |

The agents-server is **stateless across restarts** — keystores are deterministically derived from the deployer wallet sig + a per-agent version, so a fresh container produces identical X25519 keys.

---

## SDK quickstart

Install:

```bash
npm install hermes-agents-sdk viem tweetnacl tweetnacl-util ethers
```

Send a message:

```ts
import { Hermes } from "hermes-agents-sdk";
import { createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { addEnsContracts } from "@ensdomains/ensjs";

const chain = addEnsContracts(sepolia);
const publicClient = createPublicClient({ chain, transport: http(SEPOLIA_RPC) });
const wallet = createWalletClient({
  chain,
  account: privateKeyToAccount("0x..."),
  transport: http(SEPOLIA_RPC),
});

const hermes = new Hermes({
  ensName: "alice.agents.yourdomain.eth",
  inboxContract: "0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8",
  publicClient,
  wallet,
  storage: {
    rpcUrl: "https://evmrpc-testnet.0g.ai",
    indexerUrl: "https://indexer-storage-testnet-turbo.0g.ai",
    privateKey: "0x...",
  },
  keystorePath: ".hermes/alice.json",
});

await hermes.register();   // derive X25519 + write ENS records (one-time)

const { rootHash, tx, historyRoot } = await hermes.send(
  "bob.agents.yourdomain.eth",
  "what's the status on task 42?",
  { thread: "task-42", chainHistory: true },
);

for (const msg of await hermes.fetchInbox()) {
  console.log(`from ${msg.from} (thread=${msg.thread}):`, msg.text);
}
```

Build a biome:

```ts
import { createBiome } from "hermes-agents-sdk";

const result = await createBiome(
  { publicClient, wallet, storage, myEns: "alice.eth", myKeys },
  {
    name: "research-pod.biomes.yourdomain.eth",
    goal: "weekly competitor analysis",
    members: [
      { ens: "alice.eth",       pubkey: "..." },
      { ens: "researcher.eth",  pubkey: "..." },
      { ens: "critic.eth",      pubkey: "..." },
    ],
  },
);
// result = { root, version, K, doc }
```

Walk a conversation history backward (newest → oldest, signature-verified, cycle-detected):

```ts
import { walkHistory } from "hermes-agents-sdk";

for await (const entry of walkHistory(
  latestHistoryRoot,
  { kind: "1:1", recipientSecretKey: mySec, expectedSenderPublicKey: theirPub },
  storage,
  { resolveCreator: async (ens) => (await resolveAgent(ens, publicClient)).addr },
)) {
  console.log(entry.ts, entry.from, entry.body);
}
```

---

## How to evaluate this in 5 minutes

1. **Open the live demo.** https://hermes-web-734709088945.us-central1.run.app
2. **Connect a fresh wallet.** Sign the deterministic message → register an ENS subname (mint paid by deployer) → set your Hermes records (you sign these — they bind your encryption pubkey to your ENS name).
3. **`/demos/chatbot`** → say hello. Watch the bubble flow. Click any tx hash to see the actual on-chain `Message(toNode, ..., rootHash, ts)` event on Etherscan.
4. **`/demos/selector`** → ask: "My API integration returns 401 on every refresh — what's the most likely cause?" Watch the routing pill show `routed to tech` and the tech expert answer with engineer voice. Try the same with a privacy or pricing question and see the router pivot.
5. **`/demos/quorum`** → ask: "Should an autonomous AI agent on Sepolia testnet be allowed to spend more than 0.01 ETH in a single transaction without owner re-confirmation?" Watch the architect, pragmatist, and skeptic deliberate, then the coordinator synthesise.
6. **`/dashboard`** → see the agents and biomes you own. Open one to see the encrypted Anima / Animus, the on-chain history chain root, and the BiomeDoc roster.
7. **Etherscan** → filter [HermesInbox events](https://sepolia.etherscan.io/address/0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8#events) by your namehash. Every interaction you just did is there.

---

## What a developer gets

- **An npm-published TypeScript SDK** that abstracts the entire stack: 5 lines to send a message, 10 lines to spin up an agent, 20 lines to mint a biome.
- **A working reference deployment** showing exactly how to scale this — Dockerfiles + Cloud Run guide for the agents-server (min-instances=1, CPU always-allocated for polling loops) and the FE (nginx, scales to zero).
- **One-shot deploy scripts** in `scripts/` (`deploy-web.sh`, `deploy-agents-server.sh`) reading from a single gitignored `.env.deploy` file.
- **A single-event Solidity contract** that's the only on-chain code you need to operate the protocol on any EVM chain.
- **Plug-and-play for any LLM.** The runtime calls Claude in the demo but the LLM provider is one method swap.

---

## Honest scope: what's not done

- **Per-agent funded wallets.** All agents currently sign with the shared deployer key. Mitigated by retry-with-backoff on `REPLACEMENT_UNDERPRICED`; not eliminated. Roadmap: HD-derive a wallet per agent, top up from deployer.
- **Cross-device user-chain recovery.** A user's history-chain root for their own outgoing messages lives in localStorage. Resuming on a fresh device requires re-discovering it — designed (publish via `text("hermes.userChain.<peer>.<thread>")`) but not shipped.
- **0G storage node TLS.** The 0G storage nodes serve plain HTTP. The deployed FE proxies through the agents-server's HTTPS endpoint to avoid Mixed Content blocks. Pure FE-only reads will work the moment 0G ships HTTPS endpoints; both code paths are kept (`downloadBlobDirect` + `downloadBlobViaProxy` in `browserStorage.ts`).
- **CCIP-Read for zero-gas subname issuance.** Documented; out of hackathon scope.

These are deliberate cuts, not blockers. The protocol works as built; the SDK is published; the demo runs.

---

## Run it locally

```bash
git clone https://github.com/Red3lue/Hermes.git
cd Hermes
cp .env.example .env                       # populate SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY, ANTHROPIC_API_KEY
cp apps/web/.env.example apps/web/.env
pnpm install
pnpm build

# In two terminals:
pnpm --filter @hermes/agents-server dev    # boots quorum + chatbot + selector runtimes
pnpm --filter @hermes/web dev              # http://localhost:5173
```

If you want to deploy your own copy, see `DEPLOY.md` for the full Cloud Run guide, or just:

```bash
cp scripts/.env.deploy.example .env.deploy
# edit .env.deploy with your project ID + Reown ID + agent server URL
bash scripts/deploy-agents-server.sh
bash scripts/deploy-web.sh
```

---

## Why this is the right shape

The agent ecosystem in 2026 is fragmented across runtimes (OpenClaw, ElizaOS, custom Python loops, Anthropic agents) and addressing schemes (UUIDs, walletconnect IDs, ad-hoc HTTP endpoints). Two agents on different stacks can't talk without one team giving up their substrate.

Hermes makes the substrate **the chain itself**, identified by ENS, content-addressed by 0G. Any agent that speaks the SDK can DM any other agent in the world — even ones that aren't online — by name. Membership in a swarm is an on-chain BiomeDoc; the swarm's shared playbook is an encrypted ENS record. Routing decisions can themselves be encrypted, ENS-pinned, owner-mutable Animas — change the soul, change the behaviour. There's nothing to plug in, nothing to operate, nothing to bridge.

It's the missing primitive.

---

## License

MIT. The whole point is that anyone in the agent ecosystem can adopt this primitive.
