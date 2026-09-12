import { compareDexProtocols } from "./dex.js";
import { DEX_AMM_SUBGRAPHS, ETHEREUM_BLUE_CHIP_TOKENS } from "./dexRegistry.js";

// DeFi-specific terms only: generic words like "pool", "volume" or "curve"
// would pull live DEX data into unrelated questions.
const DEX_TOPIC =
  /\b(dexs?|amms?|defi|uniswap|sushiswap|sushi|curve\.fi|curve finance|liquidity|liquidity pools?|tvl|trading volume|stablecoins?|market makers?|fee tiers?|slippage|impermanent loss)\b/i;

export type DexGrounding = {
  /** Markdown block to append to an LLM prompt. */
  markdown: string;
  /** One-line source attribution for a final report. */
  footer: string;
  sources: { deployment: string; subgraphId: string; indexedBlock: number }[];
};

export function isDexQuestion(text: string): boolean {
  return DEX_TOPIC.test(text);
}

function usd(value: number): string {
  const abs = Math.abs(value);
  if (abs >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

/**
 * Fetches the live blue-chip DEX comparison and renders it for agents: a
 * prompt-ready markdown table plus a source footer naming every subgraph and
 * the block its data was indexed at.
 */
export async function buildDexGrounding(days = 7): Promise<DexGrounding> {
  const comparison = await compareDexProtocols([], days);
  if (comparison.protocols.length === 0) {
    const reasons = comparison.failures.map((f) => `${f.deployment}: ${f.error}`).join("; ");
    throw new Error(`no DEX data available (${reasons})`);
  }

  const rows = comparison.protocols.map((p) => {
    const top = p.topPools[0];
    const topPool = top ? `${top.tokens.join("/")} ${usd(top.volumeUSD)}` : "none";
    return `| ${p.protocol} | ${usd(p.blueChip.tvlUSD)} | ${usd(p.blueChip.volumeUSD)} | ${p.volumeSharePct}% | ${p.blueChip.volumeToTvl} | ${p.blueChip.takeRateBps} bps | ${topPool} | ${p.indexedBlock} |`;
  });

  const lines = [
    "## Live on-chain data (The Graph)",
    `Source: Messari standardized dex-amm subgraphs on The Graph Network, Ethereum mainnet, fetched ${comparison.generatedAt}. Window: last ${days} days. Blue-chip pools only (every token one of ${Object.values(ETHEREUM_BLUE_CHIP_TOKENS).join(", ")}). Shares are among the protocols listed.`,
    "",
    "| Protocol | Blue-chip TVL | Volume | Volume share | Volume/TVL | Take rate | Top pool by volume | Indexed block |",
    "|---|---|---|---|---|---|---|---|",
    ...rows,
  ];

  const inflated = comparison.protocols.filter((p) => !p.reported.plausible);
  if (inflated.length > 0) {
    const list = inflated.map((p) => `${p.protocol} (${p.reported.tvlUSD.toExponential(2)} USD)`);
    lines.push(
      "",
      `Data quality: the subgraphs' own reported TVL is inflated by spam-token pricing for ${list.join(", ")}, so it is excluded above.`,
    );
  }
  if (comparison.failures.length > 0) {
    lines.push(
      "",
      `Unavailable this round: ${comparison.failures.map((f) => f.deployment).join(", ")}; shares above exclude it.`,
    );
  }

  const sources = comparison.protocols.map((p) => ({
    deployment: p.deployment,
    subgraphId: DEX_AMM_SUBGRAPHS.find((d) => d.key === p.deployment)?.subgraphId ?? "",
    indexedBlock: p.indexedBlock,
  }));
  const footer = `_Data: The Graph Network · Messari standardized subgraphs (${sources.map((s) => `${s.deployment} @ block ${s.indexedBlock}`).join(", ")}) · fetched ${comparison.generatedAt}_`;

  return { markdown: lines.join("\n"), footer, sources };
}
