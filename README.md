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

## License

MIT.
