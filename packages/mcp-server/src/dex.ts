import {
  type DexDeployment,
  ETHEREUM_BLUE_CHIP_TOKENS,
  resolveDeployments,
} from "./dexRegistry.js";
import { queryGraph } from "./graph.js";

// Both queries are written once against the dex-amm standardized schema and run
// unchanged on every deployment in the registry.
const CANDIDATE_POOLS_QUERY = `
  query CandidatePools($first: Int!) {
    dexAmmProtocols(first: 1) {
      schemaVersion
      totalValueLockedUSD
    }
    liquidityPools(first: $first, orderBy: cumulativeVolumeUSD, orderDirection: desc) {
      id
      name
      totalValueLockedUSD
      inputTokens {
        id
      }
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

const POOL_SNAPSHOTS_QUERY = `
  query PoolSnapshots($pools: [String!]!, $since: BigInt!) {
    liquidityPoolDailySnapshots(first: 1000, where: { pool_in: $pools, timestamp_gte: $since }) {
      pool {
        id
      }
      dailyVolumeUSD
      dailyTotalRevenueUSD
    }
  }
`;

const CANDIDATE_POOLS = 100;
// 30 pools x 30 days stays under the 1000-row page limit of the snapshot query.
const MAX_BLUE_CHIP_POOLS = 30;
// Above any real DEX's TVL: a reported figure this large is spam-token pricing.
const PLAUSIBLE_TVL_CEILING_USD = 50e9;
const CACHE_TTL_MS = 60_000;

type CandidatePoolsData = {
  dexAmmProtocols: { schemaVersion: string; totalValueLockedUSD: string }[];
  liquidityPools: {
    id: string;
    name: string | null;
    totalValueLockedUSD: string;
    inputTokens: { id: string }[];
  }[];
  _meta: { block: { number: number; timestamp: number | null } };
};

type PoolSnapshotsData = {
  liquidityPoolDailySnapshots: {
    pool: { id: string };
    dailyVolumeUSD: string;
    dailyTotalRevenueUSD: string;
  }[];
};

export type PoolActivity = {
  id: string;
  name: string | null;
  tokens: string[];
  tvlUSD: number;
  volumeUSD: number;
  revenueUSD: number;
};

export type DexActivity = {
  deployment: string;
  protocol: string;
  network: string;
  schemaVersion: string;
  days: number;
  /** Metrics from pools whose every token is on the blue-chip allowlist. */
  blueChip: {
    pools: number;
    tvlUSD: number;
    volumeUSD: number;
    revenueUSD: number;
    /** Window volume / TVL: how hard the liquidity works. */
    volumeToTvl: number;
    /** Revenue / volume in basis points: the effective fee charged to traders. */
    takeRateBps: number;
  };
  /** The subgraph's own unfiltered protocol TVL, kept for transparency. */
  reported: { tvlUSD: number; multipleOfBlueChip: number | null; plausible: boolean };
  topPools: PoolActivity[];
  indexedBlock: number;
  indexedAt: string | null;
};

export type DexComparison = {
  generatedAt: string;
  days: number;
  method: string;
  protocols: (DexActivity & { volumeSharePct: number; tvlSharePct: number })[];
  failures: { deployment: string; error: string }[];
};

const round = (value: number) => Math.round(value);
const two = (value: number) => Math.round(value * 100) / 100;
const share = (part: number, total: number) => (total > 0 ? two((part / total) * 100) : 0);

async function fetchActivity(deployment: DexDeployment, days: number): Promise<DexActivity> {
  const candidates = await queryGraph<CandidatePoolsData>(
    deployment.subgraphId,
    CANDIDATE_POOLS_QUERY,
    { first: CANDIDATE_POOLS },
  );
  const protocol = candidates.dexAmmProtocols[0];
  if (!protocol) {
    throw new Error("subgraph returned no dexAmmProtocol entity");
  }

  const pools = candidates.liquidityPools
    .filter((p) => p.inputTokens.every((t) => t.id in ETHEREUM_BLUE_CHIP_TOKENS))
    .slice(0, MAX_BLUE_CHIP_POOLS);

  const since = String(Math.floor(Date.now() / 1000) - days * 86_400);
  const snapshots =
    pools.length === 0
      ? []
      : (
          await queryGraph<PoolSnapshotsData>(deployment.subgraphId, POOL_SNAPSHOTS_QUERY, {
            pools: pools.map((p) => p.id),
            since,
          })
        ).liquidityPoolDailySnapshots;

  const window = new Map<string, { volume: number; revenue: number }>();
  for (const s of snapshots) {
    const entry = window.get(s.pool.id) ?? { volume: 0, revenue: 0 };
    entry.volume += Number(s.dailyVolumeUSD);
    entry.revenue += Number(s.dailyTotalRevenueUSD);
    window.set(s.pool.id, entry);
  }

  const topPools: PoolActivity[] = pools
    .map((p) => ({
      id: p.id,
      name: p.name,
      tokens: p.inputTokens.map((t) => ETHEREUM_BLUE_CHIP_TOKENS[t.id]),
      tvlUSD: round(Number(p.totalValueLockedUSD)),
      volumeUSD: round(window.get(p.id)?.volume ?? 0),
      revenueUSD: round(window.get(p.id)?.revenue ?? 0),
    }))
    .sort((a, b) => b.volumeUSD - a.volumeUSD);

  const tvlUSD = topPools.reduce((sum, p) => sum + p.tvlUSD, 0);
  const volumeUSD = topPools.reduce((sum, p) => sum + p.volumeUSD, 0);
  const revenueUSD = topPools.reduce((sum, p) => sum + p.revenueUSD, 0);
  const reportedTvl = Number(protocol.totalValueLockedUSD);
  const blockTime = candidates._meta.block.timestamp;

  return {
    deployment: deployment.key,
    protocol: deployment.protocol,
    network: deployment.network,
    schemaVersion: protocol.schemaVersion,
    days,
    blueChip: {
      pools: topPools.length,
      tvlUSD,
      volumeUSD,
      revenueUSD,
      volumeToTvl: tvlUSD > 0 ? two(volumeUSD / tvlUSD) : 0,
      takeRateBps: volumeUSD > 0 ? two((revenueUSD / volumeUSD) * 10_000) : 0,
    },
    reported: {
      tvlUSD: reportedTvl,
      multipleOfBlueChip: tvlUSD > 0 ? two(reportedTvl / tvlUSD) : null,
      plausible: reportedTvl < PLAUSIBLE_TVL_CEILING_USD,
    },
    topPools,
    indexedBlock: candidates._meta.block.number,
    indexedAt: blockTime ? new Date(blockTime * 1000).toISOString() : null,
  };
}

// The candidate-pools query takes up to ~20s on large subgraphs; the MCP tools
// and the quorum often ask for the same data back to back.
const cache = new Map<string, { expires: number; value: Promise<DexActivity> }>();

function getActivity(deployment: DexDeployment, days: number): Promise<DexActivity> {
  const key = `${deployment.key}:${days}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }
  const value = fetchActivity(deployment, days);
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  value.catch(() => cache.delete(key));
  return value;
}

/**
 * Compares DEX protocols on live data from their standardized subgraphs,
 * using only blue-chip pools so spam-token pricing can't distort the result.
 * One deployment failing does not fail the comparison; it is reported in `failures`.
 */
export async function compareDexProtocols(
  keys: readonly string[],
  days: number,
): Promise<DexComparison> {
  const deployments = resolveDeployments(keys);
  const settled = await Promise.allSettled(deployments.map((d) => getActivity(d, days)));

  const activity: DexActivity[] = [];
  const failures: DexComparison["failures"] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      activity.push(result.value);
    } else {
      const reason = result.reason;
      failures.push({
        deployment: deployments[i].key,
        error: reason instanceof Error ? reason.message : String(reason),
      });
    }
  });

  const totalVolume = activity.reduce((sum, a) => sum + a.blueChip.volumeUSD, 0);
  const totalTvl = activity.reduce((sum, a) => sum + a.blueChip.tvlUSD, 0);
  return {
    generatedAt: new Date().toISOString(),
    days,
    method: `Per protocol: top ${CANDIDATE_POOLS} pools by cumulative volume, keeping those whose every token is on the blue-chip allowlist (max ${MAX_BLUE_CHIP_POOLS}); window metrics summed from their daily snapshots.`,
    protocols: activity
      .map((a) => ({
        ...a,
        volumeSharePct: share(a.blueChip.volumeUSD, totalVolume),
        tvlSharePct: share(a.blueChip.tvlUSD, totalTvl),
      }))
      .sort((a, b) => b.blueChip.volumeUSD - a.blueChip.volumeUSD),
    failures,
  };
}

export async function topPools(key: string, days: number, first: number): Promise<PoolActivity[]> {
  const [deployment] = resolveDeployments([key]);
  const activity = await getActivity(deployment, days);
  return activity.topPools.slice(0, first);
}
