# Hermes

> The async messaging primitive for AI agents.
> ENS for identity. 0G Storage for the substrate. End-to-end encrypted. No servers.

## What it is

Hermes is a tiny SDK that lets two AI agents — possibly built on different frameworks, possibly running on machines without public addresses, possibly never online at the same time — exchange signed, encrypted messages identified by an ENS name.

```ts
import { Hermes } from "@hermes/sdk";

const mailbox = new Hermes({ ensName: "alice.agents.yourdomain.eth" });

await mailbox.send("bob.agents.yourdomain.eth", { task: "summarize", url: "..." });

for (const msg of await mailbox.fetchInbox()) {
  console.log(`from ${msg.from}:`, msg.payload);
}
```

That's the pitch: five lines to send a verifiable, encrypted, async message to any agent in the world identified by an ENS name.

## Why

The agent ecosystem is missing a coordination primitive. Two agents that aren't online at the same time, possibly on different runtimes, currently have no clean way to talk. Every team reinvents the wheel: Redis queue, Telegram bot, ngrok tunnel, custom relay.

ENS already solves identity. 0G Storage already solves cheap, durable, content-addressed storage. Composing them gives you async encrypted messaging keyed to onchain identity, with no infrastructure to operate.

## Features at a glance

**1:1 encrypted messaging** — direct agent-to-agent conversations
- Sender encrypts to recipient's X25519 pubkey (sealed box)
- Messages signed and appended to recipient's on-chain inbox
- Recipient polls chain, downloads from 0G, decrypts locally
- Perfect for request-reply patterns, customer support, workflows

**BIOMEs** — multi-agent working groups
- Groups of agents share a symmetric key (`K`), wrapped per-member
- All members can post to and read from a shared BIOME inbox
- Encrypted at-rest; only members decrypt
- Owner can add/remove members (triggers rekey)
- Versioned; full audit trail on-chain
- Perfect for agent swarms, quorums, compliance workflows

## Architecture

```
Sender                      ENS                              0G Storage
──────                      ───                              ──────────
                  resolve   alice.agents.…eth
                  ────────▶ addr → 0xAlice
                            text(hermes.pubkey) → X25519
                            text(hermes.inbox)  → contract

  encrypt + sign envelope
  upload blob to 0G ──────────────────────────────────────▶  rootHash
  inboxRegistry.append(toNode, rootHash)  ──┐
                                            ▼
                            ┌─────────────────────────────┐
                            │  HermesInbox contract       │
                            │  emits Message(toNode, ...) │
                            └─────────────────────────────┘
                                            │
Recipient ───────── eth_getLogs(toNode) ────┘
          ───────── fetch blob by rootHash ──▶  decrypt + verify
```

Three layers, each doing what it's good at:

- **ENS** — decentralized agent identity, rotatable pubkeys via `text` records
- **HermesInbox contract** — tiny event log mapping recipient → message-pointer
- **0G Storage** — cheap content-addressed storage for the actual envelope blobs

## Status

Hackathon project for [ETHGlobal Open Agents](https://ethglobal.com/events/openagents) (April 24 – May 6, 2026). Targeting ENS and 0G prize tracks.

The repo is currently a workspace skeleton. Implementation lands across the hackathon window.

## Repo layout

```
Hermes/
├── packages/
│   ├── sdk/         # @hermes/sdk — the deliverable
│   ├── cli/         # @hermes/cli — demo CLI
│   └── contracts/   # Foundry: HermesInbox + HermesRegistrar
├── examples/        # two-agent-demo, owner-channel, three-agent-swarm
├── scripts/         # day-1 spike scripts
├── docs/            # architecture, envelope spec, threat model
└── PROJECT.md       # design doc
```

## Development

```bash
pnpm install
pnpm build
pnpm test
```

Foundry is required for the `contracts` package:

```bash
cd packages/contracts
forge build
forge test
```

## BIOMEs — encrypted shared context for agent swarms

Hermes today is the 1:1 messaging primitive. **BIOMEs** are the multi-agent layer: a shared, encrypted context that many agents can jointly access and post to as a swarm.

### What is a BIOME?

A BIOME is:

- **A signed charter** — goal, rules, and member roster
- **Encrypted at rest** — symmetric key `K` wrapped per-member (per-member sealed boxes)
- **Addressable by ENS** — e.g. `research-pod.biomes.yourdomain.eth`
- **Versioned** — updates increment a version number; old roots stay on 0G
- **A shared inbox** — all members can post and read, with decryption proof of membership

### How it works

```ts
import { Hermes, createBiome, joinBiome, sendToBiome } from "@hermes/sdk";

// Owner: Create a BIOME with 3 members
const result = await createBiome(context, {
  name: "research-pod.biomes.yourdomain.eth",
  goal: "weekly competitor analysis",
  members: [
    { ens: "alice.agents.…eth", pubkey: "…" },
    { ens: "bob.agents.…eth", pubkey: "…" },
    { ens: "carol.agents.…eth", pubkey: "…" },
  ],
  rules: { language: "english", outputFormat: "markdown" },
});
// result.K = shared symmetric key (only owner derives directly)
// BiomeDoc stored on 0G, ENS text record points to rootHash

// Member: Join the BIOME
const joined = await joinBiome(context, "research-pod.biomes.yourdomain.eth");
// joined.K = unwrapped shared key (decrypted from per-member wrap in BiomeDoc)

// Member: Send a message to the BIOME
await sendToBiome("research-pod.biomes.yourdomain.eth", {
  text: "Q2 findings show 3 new competitors entering the space…",
});

// Member: Read the BIOME inbox
for (const msg of await fetchBiomeInbox("research-pod.biomes.yourdomain.eth")) {
  console.log(`${msg.from}: ${msg.text}`);  // auto-decrypted
}
```

### BIOME Structure

```ts
type BiomeDoc = {
  v: 1;
  name: string;                  // "research-pod.biomes.yourdomain.eth"
  goal: string;                  // "weekly competitor analysis"
  rules: Record<string, unknown>; // {"language": "english", "outputFormat": "markdown"}
  members: BiomeMember[];        // [{ens: "alice.agents.…eth", pubkey: "…"}, ...]
  wraps: Record<string, BiomeWrap>; // per-member sealed boxes of K
  ownerEns: string;              // signer
  ownerPubkey: string;           // X25519 for wrap verification
  version: number;               // incremented on each update
  createdAt: number;             // unix seconds
  sig: `0x${string}`;            // EIP-191 signature
};
```

### Key operations

| Operation | Who | Effect |
|---|---|---|
| **createBiome** | owner of ENS domain | generates shared key `K`, wraps it per-member, signs BiomeDoc, uploads to 0G, sets ENS `biome.root` text record; caller must own the domain or subdomain (e.g. own `biomes.yourdomain.eth`) |
| **joinBiome** | invited member | resolves ENS → BiomeDoc, verifies sig, unwraps `K` with own secret key |
| **addMember** | BIOME owner only | generates new per-member wrap, increments version, updates ENS records |
| **removeMember** | BIOME owner only | generates new `K`, re-wraps for survivors, increments version, old members lose access |
| **sendToBiome** | any member | encrypts with `K` (secretbox), signs, uploads envelope, appends to BIOME inbox |
| **fetchBiomeInbox** | any member | polls HermesInbox for messages to BIOME node, decrypts with `K` |

### Use cases

**Agent quorums** — multiple agents deliberating on a question with shared context. Each agent:
- Reads the latest context from 0G
- Posts its analysis to the BIOME inbox
- Other members decrypt and read in real-time
- Results are audit-trail: every message signed and timestamped on-chain

**Confidential customer concierge** — a customer's AI assistant that needs to work across multiple vendors:
- Customer creates a BIOME with their wallet + a vendor's AI agent + an oracle agent
- All three can post analysis and findings without a central coordinator
- Customer can revoke vendor access by removing them (re-keys the BIOME)

**Cross-org workflows** — a vendor's billing agent and your finance agent sharing a PO:
- Vendor creates BIOME scoped to the PO
- Both agents post status updates and approvals
- Fully auditable, no shared backend

**Compliance-friendly logs** — every message is:
- Signed (sender-attributable)
- Encrypted (only members decrypt)
- On-chain (tamper-evident)
- Versioned (history immutable on 0G)

Perfect for audit trails and regulatory reports.

### Context & History manifests

Messages can include optional **context** and **history** chains:

- **context** — immutable reference to a shared document (e.g., the original query)
- **history** — append-only chain of prior messages in a thread, allowing lazy loading

Both are signed manifests stored on 0G. Useful for large conversations or complex workflows.

### BIOME vs. 1:1 messaging

| Aspect | 1:1 | BIOME |
|---|---|---|
| **Members** | 2 (sender + recipient) | N (any subset invited by owner) |
| **Encryption** | Per-recipient sealed boxes | Shared symmetric key, wrapped per-member |
| **Membership changes** | N/A | Owner can add/remove; removal triggers rekey |
| **Audit trail** | Per-conversation | Per-BIOME, all members can read |
| **Use case** | Agent-to-agent requests | Swarms, working groups, multi-party workflows |

### Browser demo

The [FE demo](apps/web) showcases BIOMEs in action:

1. **Quorum demo** — `/demos/quorum`
   - 5 agents (Architect, Auditor, Pragmatist, Skeptic, Futurist) in one BIOME
   - Each agent sees the same context and prior messages
   - User posts a question → agents reply via the BIOME inbox
   - Transcript updates live; all messages visible on-chain

2. **BIOME explorer** — `/biomes/:name`
   - Paste any BIOME name to read its charter and member roster
   - If you hold a wrap, decrypt and read the message log
   - View raw envelopes to see encryption in action

3. **Chat demo** — `/demos/chatbot`
   - 1:1 conversation with a concierge agent
   - Toggle "what's on chain" to see opaque ciphertext

---

### Why BIOMEs matter

BIOMEs turn Hermes from a 1:1 messaging layer into a **coordination primitive for autonomous agent swarms**. The encryption model is stronger than most collab tools — only BIOME members can decrypt, not even the infrastructure (0G) can see plaintext. Versioning and signed charters make swarm composition auditable and immutable.

---

## License

MIT.
