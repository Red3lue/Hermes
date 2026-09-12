// Messari Standardized Subgraphs implementing the `dex-amm` schema, production
// deployments on The Graph Network. Every entry answers the same GraphQL
// queries, which is what lets one pipeline compare protocols.
// Source: https://github.com/messari/subgraphs/blob/master/deployment/deployment.json
// Checked live 2026-09-11. Excluded: balancer-v2-ethereum (indexers report
// indexing_error), pancakeswap-v3-ethereum (no allocations),
// uniswap-v2-swap-ethereum (no pricing).

export type DexDeployment = {
  key: string;
  protocol: string;
  network: string;
  subgraphId: string;
};

export const DEX_AMM_SUBGRAPHS: readonly DexDeployment[] = [
  {
    key: "uniswap-v3-ethereum",
    protocol: "Uniswap v3",
    network: "ethereum",
    subgraphId: "4cKy6QQMc5tpfdx8yxfYeb9TLZmgLQe44ddW1G7NwkA6",
  },
  {
    key: "curve-finance-ethereum",
    protocol: "Curve",
    network: "ethereum",
    subgraphId: "3fy93eAT56UJsRCEht8iFhfi6wjHWXtZ9dnnbQmvFopF",
  },
  {
    key: "sushiswap-ethereum",
    protocol: "SushiSwap",
    network: "ethereum",
    subgraphId: "77jZ9KWeyi3CJ96zkkj5s1CojKPHt6XJKjLFzsDCd8Fd",
  },
];

/**
 * Ethereum mainnet tokens trusted for pricing, keyed by lowercase address.
 * Matched by address, not symbol: spam tokens copy symbols, and their prices
 * are what poison the subgraphs' protocol-level TVL.
 */
export const ETHEREUM_BLUE_CHIP_TOKENS: Readonly<Record<string, string>> = {
  "0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2": "WETH",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee": "ETH",
  "0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48": "USDC",
  "0xdac17f958d2ee523a2206206994597c13d831ec7": "USDT",
  "0x6b175474e89094c44da98b954eedeac495271d0f": "DAI",
  "0x2260fac5e5542a773aa44fbcfedf7c193bc2c599": "WBTC",
  "0xae7ab96520de3a18e5e111b5eaab095312d7fe84": "stETH",
  "0x7f39c581f595b53c5cb19bd0b3f8da6c935e2ca0": "wstETH",
};

export function resolveDeployments(keys: readonly string[]): DexDeployment[] {
  if (keys.length === 0) {
    return [...DEX_AMM_SUBGRAPHS];
  }
  return keys.map((key) => {
    const deployment = DEX_AMM_SUBGRAPHS.find((d) => d.key === key);
    if (!deployment) {
      const valid = DEX_AMM_SUBGRAPHS.map((d) => d.key).join(", ");
      throw new Error(`Unknown DEX deployment "${key}". Valid keys: ${valid}`);
    }
    return deployment;
  });
}
