# Continuity Disclosure — Hermes v2 @ ETHOnline 2026

ETHGlobal Continuity-track rule: pre-existing work must be disclosed in writing and clearly
separated from hackathon-period work. This file is that disclosure.

## Pre-existing work (before Sep 4, 2026)

Everything at git tag **`v1-baseline`** (commit `edd9a6c`) was built for ETHGlobal Open Agents
(April–May 2026) and is out of scope for judging:

- `packages/sdk` — ENS subname PKI resolution, X25519/EIP-191 crypto, 0G Storage envelopes,
  `HermesInbox` read/write (published on npm as `hermes-agents-sdk`)
- `packages/contracts` — `HermesInbox.sol`, deployed on Sepolia at
  `0x1cCD7DDb0c5F42BDB22D8893aDC5E7EA68D9CDD8`
- `apps/agents-server` — polling runtime, Claude inference, chatbot / quorum / selector agents
- `apps/web` — React UI and the three demos
- Anima / Animus encrypted "soul" documents, biomes

Repository: https://github.com/Red3lue/Hermes — the original Hermes repo (not a fork).

## New work (Sep 4 – Sep 13, 2026)

All hackathon work lands on branch `ethonline-2026` as regular commits on top of `v1-baseline`.
Diff of the judged work: `git diff v1-baseline...ethonline-2026`.

Shipped:

- [x] The Graph: new `packages/mcp-server`, an MCP server + `SKILL.md` serving **live** DEX
      data from Messari standardized subgraphs (Uniswap v3, Curve, SushiSwap), filtered to
      blue-chip pools because spam-token pricing inflates the subgraphs' own TVL. The quorum
      coordinator grounds DeFi questions in that data before fan-out, members are instructed to cite it, and the
      final report carries the subgraphs and indexed blocks it used
      (`apps/agents-server/src/quorum/coordinator.ts`, `member.ts`)
- [x] Production hardening found while deploying: pool discovery refreshes in the background with
      a checked-in fallback list, and the agents' Sepolia RPC accepts a fallback list so provider
      rate limits don't stall inbox polling (`apps/agents-server/src/rpc.ts`)

Dropped during the event (not started), for lack of time: Hedera x402 agent payments, and the
ENSv2 (Sepolia) migration of agent subnames.

How AI tools were used for this work: see [AI_USAGE.md](./AI_USAGE.md).

All new code is open source under the repository licence.
