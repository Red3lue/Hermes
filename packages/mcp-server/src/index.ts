#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { compareDexProtocols, topPools } from "./dex.js";
import { DEX_AMM_SUBGRAPHS, ETHEREUM_BLUE_CHIP_TOKENS } from "./dexRegistry.js";
import { loadRootEnv } from "./env.js";
import { queryGraph } from "./graph.js";

loadRootEnv();

const server = new McpServer({ name: "hermes-graph", version: "0.0.0" });

const readOnly = { readOnlyHint: true, openWorldHint: true } as const;

function json(value: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(value, null, 2) }] };
}

function failure(err: unknown) {
  const message = err instanceof Error ? err.message : String(err);
  return { isError: true, content: [{ type: "text" as const, text: message }] };
}

server.registerTool(
  "dex_list_deployments",
  {
    title: "List standardized DEX subgraphs",
    description:
      "Lists the DEX protocols available through Messari's dex-amm Standardized Subgraphs on The Graph Network, plus the blue-chip token allowlist used to filter pools. Every deployment shares one schema, so one pipeline compares them all.",
    annotations: readOnly,
  },
  async () => json({ deployments: DEX_AMM_SUBGRAPHS, blueChipTokens: ETHEREUM_BLUE_CHIP_TOKENS }),
);

server.registerTool(
  "dex_compare_protocols",
  {
    title: "Compare DEX protocols on live Graph data",
    description:
      "Compares DEX protocols on live data from their standardized subgraphs. Uses only blue-chip pools (every token on an address allowlist), because spam-token pricing inflates the subgraphs' own TVL by orders of magnitude. Returns per protocol: blue-chip TVL, window volume and revenue, volume and TVL share, volume/TVL (capital efficiency), take rate in bps, top pools, the unfiltered reported TVL with a plausibility flag, and the indexed block proving freshness. Defaults to all deployments.",
    inputSchema: {
      protocols: z
        .array(z.string())
        .optional()
        .describe("Deployment keys from dex_list_deployments. Omit for all."),
      days: z
        .number()
        .int()
        .min(1)
        .max(30)
        .default(7)
        .describe("Window of daily snapshots to sum."),
    },
    annotations: readOnly,
  },
  async ({ protocols, days }) => {
    try {
      return json(await compareDexProtocols(protocols ?? [], days));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "dex_top_pools",
  {
    title: "Top blue-chip pools of a DEX",
    description:
      "Returns one DEX's blue-chip pools ranked by volume over the window, with tokens, TVL, volume and revenue.",
    inputSchema: {
      protocol: z.string().describe("Deployment key from dex_list_deployments."),
      days: z.number().int().min(1).max(30).default(7),
      first: z.number().int().min(1).max(30).default(10),
    },
    annotations: readOnly,
  },
  async ({ protocol, days, first }) => {
    try {
      return json(await topPools(protocol, days, first));
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  "graph_query_subgraph",
  {
    title: "Query any subgraph",
    description:
      "Runs a raw GraphQL query against any subgraph on The Graph Network by subgraph ID. Use for data the standardized DEX tools don't cover.",
    inputSchema: {
      subgraphId: z.string().describe("Subgraph ID on The Graph Network."),
      query: z.string().describe("GraphQL query."),
      variables: z.record(z.string(), z.unknown()).optional(),
    },
    annotations: readOnly,
  },
  async ({ subgraphId, query, variables }) => {
    try {
      return json(await queryGraph(subgraphId, query, variables));
    } catch (err) {
      return failure(err);
    }
  },
);

await server.connect(new StdioServerTransport());
// stdout carries the MCP protocol; diagnostics go to stderr.
console.error("hermes-graph MCP server running on stdio");
