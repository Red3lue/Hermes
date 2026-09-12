---
name: hermes-graph
description: "Live, spam-filtered DEX market data from The Graph for AI agents. Compares Uniswap v3, Curve and SushiSwap through Messari's standardized dex-amm subgraphs: blue-chip TVL, volume and revenue, market share, capital efficiency and take rate, with the indexed block that proves freshness."
---

# hermes-graph: live DEX data from The Graph

An MCP server that gives AI clients (Claude Desktop, Claude Code, Cursor, or any MCP client)
**live** decentralized-exchange data from The Graph Network, cleaned so an agent can reason
over it safely. It is also the data layer of the Hermes agent quorum: when a user asks the
quorum a DeFi question, the coordinator fetches this data and every member deliberates over
the same numbers.

## When to use it

Use these tools when a question depends on the current state of Ethereum DEX markets:
which venue has the liquidity, where volume is concentrated, what traders effectively pay,
whether a protocol is still relevant. Don't use them for historical analysis beyond 30 days,
for chains other than Ethereum mainnet, or for token prices.

## Setup

Requirements: Node.js 18+, pnpm, and a Graph API key (Subgraph Studio → **API Keys** →
**Create API Key**; the free plan is enough).

```bash
git clone https://github.com/Red3lue/Hermes.git && cd Hermes
git checkout ethonline-2026
pnpm install
pnpm --filter @hermes/mcp-server build
```

Check that live data flows before wiring up a client:

```bash
GRAPH_API_KEY=<your key> pnpm --filter @hermes/mcp-server smoke
```

It prints the comparison as JSON and exits non-zero if no protocol returned data.

### Claude Desktop

Add to `claude_desktop_config.json`, using the absolute path to your clone:

```json
{
  "mcpServers": {
    "hermes-graph": {
      "command": "node",
      "args": ["/absolute/path/to/Hermes/packages/mcp-server/dist/index.js"],
      "env": { "GRAPH_API_KEY": "<your key>" }
    }
  }
}
```

### Claude Code

```bash
claude mcp add hermes-graph -e GRAPH_API_KEY=<your key> -- node /absolute/path/to/Hermes/packages/mcp-server/dist/index.js
```

For local development the server also reads `GRAPH_API_KEY` from the repository-root `.env`.

## Tools

All tools are read-only.

| Tool | Input | Returns |
|---|---|---|
| `dex_list_deployments` | none | The supported deployments (protocol, network, subgraph ID) and the blue-chip token allowlist. |
| `dex_compare_protocols` | `protocols?` (deployment keys, default all), `days` (1–30, default 7) | Per protocol: blue-chip TVL, window volume and revenue, volume share and TVL share, volume/TVL, take rate in bps, top pools, the subgraph's unfiltered reported TVL with a plausibility flag, and the indexed block and timestamp. Protocols that fail are listed in `failures` instead of failing the call. |
| `dex_top_pools` | `protocol` (deployment key), `days` (1–30, default 7), `first` (1–30, default 10) | That protocol's blue-chip pools ranked by window volume, with tokens, TVL, volume and revenue. |
| `graph_query_subgraph` | `subgraphId`, `query`, `variables?` | Raw GraphQL result from any subgraph on The Graph Network, for anything the DEX tools don't cover. |

Deployment keys: `uniswap-v3-ethereum`, `curve-finance-ethereum`, `sushiswap-ethereum`.

### Reading the numbers

- **Blue-chip TVL**: liquidity in pools where every token is WETH, ETH, USDC, USDT, DAI, WBTC,
  stETH or wstETH.
- **Volume share / TVL share**: relative to the protocols in the same response.
- **Volume/TVL**: window volume divided by TVL, i.e. how hard the liquidity works.
- **Take rate**: revenue ÷ volume in basis points, the effective fee traders paid.
- **reported.plausible = false**: the subgraph's own protocol TVL is inflated by spam-token
  pricing and should not be quoted.
- **indexedBlock / indexedAt**: the Ethereum block the data reflects. Cite it when freshness matters.

## Method, and why it's needed

Messari's [Standardized Subgraphs](https://thegraph.com/docs/en/subgraphs/existing-subgraphs/standard-subgraphs/)
give every DEX the same `dex-amm` schema, so one pipeline serves all three protocols unchanged.
But their protocol-level TVL can't be trusted: spam tokens with absurd prices inflate it. On
2026-09-11 Uniswap v3 reported about $1e43 and SushiSwap about $1.07 trillion. So the server:

1. Keeps only pools whose every token is on the blue-chip allowlist, matched **by address**,
   because spam tokens copy symbols.
2. Finds those pools among each protocol's top 100 pools by cumulative volume (at most 30 per
   protocol). That discovery query is slow on large subgraphs, so it refreshes in the background
   every 6 hours, with a checked-in seed list (`src/dexSeedPools.ts`) as fallback. Requests
   never wait on it.
3. Reads TVL live from each pool and sums volume and revenue from the pools' live daily
   snapshots, all in one fast query per protocol.
4. Caches each result for 60 seconds, because agents and tools often ask for the same data
   back to back.

What becomes easier because of the shared schema: adding a DEX is one registry entry, with no
new queries, mappings or normalization code.

## Limits

- Ethereum mainnet only: the allowlist holds Ethereum token addresses.
- Three DEXs. `balancer-v2-ethereum`, `pancakeswap-v3-ethereum` and `uniswap-v2-swap-ethereum`
  were excluded after live checks (indexing errors, no allocations, no pricing).
- Pools outside the blue-chip set (long-tail tokens) are intentionally not counted.
- Data depends on The Graph Network's indexers. A protocol can be temporarily unavailable; the
  response says so in `failures`.

## Example prompts

- "Compare Uniswap v3, Curve and SushiSwap over the last 7 days. Where is stablecoin liquidity
  deepest, and what does each charge traders?"
- "Is SushiSwap still a meaningful venue on Ethereum? Use live data and cite the block."
- "Which Curve pools carried the most volume this week?"
