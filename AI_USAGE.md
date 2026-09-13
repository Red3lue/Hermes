# AI Tool Usage: ETHOnline 2026

ETHGlobal asks submissions to document where and how AI tools were used. This file covers the
hackathon work only: branch `ethonline-2026`, everything after tag `v1-baseline`. For what existed
before the event, see [CONTINUITY.md](./CONTINUITY.md).

## Tool

**Claude Code** (Anthropic, model Claude Opus 5), used in the terminal as a pair programmer.

## How it was used

- **The author directed the work:** chose the sponsor track, set scope, and made the calls to drop
  work for time (Hedera x402 payments, the ENSv2 migration).
- **Claude Code did the hands-on work:** it researched the ETHGlobal and partner rules, read the
  existing codebase, wrote the new code and docs, and ran the checks (typecheck, lint, live
  smoke tests against The Graph, an MCP stdio handshake test, a coordinator test harness with a
  fake runtime, a Docker build, and diagnosis of production logs).
- **The author reviewed and shipped it:** every commit and push, and all deployment (Cloud Run,
  Secret Manager, RPC keys), was done by the author.

Every commit on this branch after `v1-baseline` was prepared with Claude Code.

## Where AI assisted, by file

| Area | Files | AI involvement |
|---|---|---|
| Continuity disclosure | `CONTINUITY.md` | Drafted by AI, directed and reviewed by the author |
| Graph gateway client | `packages/mcp-server/src/graph.ts`, `src/env.ts` | Written by AI |
| Standardized DEX pipeline | `packages/mcp-server/src/dex.ts`, `dexRegistry.ts`, `dexSeedPools.ts`, `smoke.ts` | Written by AI. The seed pool list was generated from a live discovery run against The Graph |
| MCP server | `packages/mcp-server/src/index.ts` | Written by AI |
| Agent grounding | `packages/mcp-server/src/grounding.ts`, `apps/agents-server/src/quorum/coordinator.ts`, `member.ts` | Written by AI |
| RPC resilience | `apps/agents-server/src/rpc.ts`, `chain.ts`, `routes/register.ts`, `runtime/agentRuntime.ts` | Written by AI after diagnosing rate limits in production logs |
| Build and config | `apps/agents-server/Dockerfile`, `package.json` files, `pnpm-lock.yaml`, `.env.example` | Edited by AI |
| Docs | `packages/mcp-server/SKILL.md`, `packages/mcp-server/README.md`, the ETHOnline section of `README.md`, this file | Drafted by AI |

## Not covered here

- **Hermes' agents call the Anthropic API at runtime** to deliberate and write reports. That is
  part of the product and existed before the event; it is not development assistance.
- **No spec-driven workflow** (OpenSpec, Kiro, spec-kit) was used. Planning happened in
  conversation and in private notes.
