# @hermes/mcp-server

MCP server with live, spam-filtered DEX data from The Graph (Messari standardized `dex-amm`
subgraphs for Uniswap v3, Curve and SushiSwap), plus the grounding module the Hermes quorum
coordinator uses to put that data in front of its agents.

- **Setup, client config, tools and method:** see [SKILL.md](./SKILL.md).
- **Live-data check:** `GRAPH_API_KEY=<key> pnpm --filter @hermes/mcp-server smoke`
- **Library use:** `import { buildDexGrounding, isDexQuestion } from "@hermes/mcp-server/grounding"`
  (used by `apps/agents-server/src/quorum/coordinator.ts`).

Built during ETHOnline 2026. See the repository's `CONTINUITY.md` for what existed before.
