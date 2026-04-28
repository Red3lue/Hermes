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

## Roadmap: BIOME — shared context for agent swarms

> ⚠️ **Naming note:** This collides with the `Biome` linter currently in `biome.json`. Rename one before shipping. Candidates for the feature: `Commons`, `Charter`, `Pact`, `Lodge`. The rest of this section uses `BIOME` per the design intent.

Hermes today is the messaging primitive — two agents can talk. **BIOME** is the next layer: a shared, addressable **context object** that many agents bind to as a precondition for participating in a goal.

Mental model: the README of a swarm. When an agent joins, it reads the BIOME. When a sender includes a BIOME reference in an envelope, the recipient knows *this message is part of that effort, with those rules*.

### v0 — alignment-only (in scope for the hackathon if time permits)

A signed JSON document, ENS-resolvable, stored on 0G:

```json
{
  "v": 1,
  "name": "research-pod-2026Q2",
  "goal": "weekly competitor analysis report",
  "members": ["alice.agents.…eth", "bob.agents.…eth", "carol.agents.…eth"],
  "rules": { "language": "english", "outputFormat": "markdown" },
  "createdBy": "alice.agents.…eth",
  "sig": "<EIP-191 over canonical biome by createdBy>"
}
```

Composes with what Hermes already has — no new infrastructure:

| Layer | Reuse |
|---|---|
| Identity | ENS subname (`research-pod.biome.yourdomain.eth`) |
| Storage | 0G blob, returns rootHash |
| Discovery | ENS `text("biome.root")` points at the rootHash |
| Versioning | Update the text record; old versions stay on 0G |
| Auth | Same EIP-191 signing scheme |
| Reference from messages | Optional `biome` field in envelope: `{ name, version, root }` |

### v1 — shared workspace (post-hackathon)

Once agents share a BIOME, they can also share a **workspace**: an append-only log scoped to BIOME members where each writes intermediate findings, drafts, and reviews. Structurally identical to a personal inbox, but the recipient is the BIOME itself and writes are gated by membership.

Three sub-problems, ranked by feasibility:

1. **Shared scratchpad / blackboard** — append-only, per-BIOME. Reuses the inbox primitive almost as-is.
2. **Pipeline handoff** (A produces → B consumes → C critiques) — already possible today; BIOME just makes roles explicit.
3. **Mergeable artifact** (collaborative document with conflict resolution) — out of scope; needs CRDTs or a coordinator agent.

Build v1 around (1) and (2). Punt on (3).

### Why BIOME strengthens the project

It turns Hermes from "agents can DM each other" into "agents can form goal-aligned swarms" — directly aligned with the **0G Best Autonomous Agents, Swarms & iNFT Innovations** prize track that messaging-only would weakly fit.

---

## License

MIT.
