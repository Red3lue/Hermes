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

Planned new features (updated as they ship):

- [ ] ENSv2 (Sepolia) migration of agent subnames: hierarchical registry + permissioned resolver
      holding X25519 keys and Anima pointers — agents as ENSv2 namespaces
- [ ] The Graph: Hermes MCP server + SKILL.md consuming **live** subgraph / Token API data;
      quorum agents ground their answers in that data
- [ ] Hedera: coordinator pays quorum agents per answer via x402 (Blocky402 facilitator),
      HCS audit trail per vote

All new code is open source under the repository licence.
