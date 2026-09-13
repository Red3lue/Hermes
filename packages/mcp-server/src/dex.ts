import {
  type DexDeployment,
  ETHEREUM_BLUE_CHIP_TOKENS,
  resolveDeployments,
} from "./dexRegistry.js";
import { SEED_BLUE_CHIP_POOLS } from "./dexSeedPools.js";
import { queryGraph } from "./graph.js";

// Both queries are written once against the dex-amm standardized schema and run
// unchanged on every deployment in the registry.

// Slow on large subgraphs (10-20s, and it times out when indexers lag), so it
// only runs in the background to refresh the pool universe.
const DISCOVERY_QUERY = `
  query DiscoverPools($first: Int!) {
    liquidityPools(first: $first, orderBy: cumulativeVolumeUSD, orderDirection: desc) {
      id
      inputTokens {
        id
      }
    }
  }
`;

// Fast (<1s): everything a round needs, for a known set of pools.
const ACTIVITY_QUERY = `
  query PoolActivity($pools: [String!]!, $since: BigInt!) {
    dexAmmProtocols(first: 1) {
      schemaVersion
      totalValueLockedUSD
    }
    liquidityPools(first: 100, where: { id_in: $pools }) {
      id
      name
      totalValueLockedUSD
      inputTokens {
        id
      }
    }
    liquidityPoolDailySnapshots(first: 1000, where: { pool_in: $pools, timestamp_gte: $since }) {
      pool {
        id
      }
      dailyVolumeUSD
      dailyTotalRevenueUSD
    }
    _meta {
      block {
        number
        timestamp
      }
    }
  }
`;

const CANDIDATE_POOLS = 100;
// 30 pools x 30 days stays under the 1000-row page limit of the snapshot query.
const MAX_BLUE_CHIP_POOLS = 30;
// Above any real DEX's TVL: a reported figure this large is spam-token pricing.
const PLAUSIBLE_TVL_CEILING_USD = 50e9;
const CACHE_TTL_MS = 60_000;
// One slow protocol must not hold back the others.
const DEPLOYMENT_DEADLINE_MS = 12_000;
// How old a last-good result may be when a live fetch is slow or failing.
const STALE_MAX_AGE_MS = 30 * 60 * 1000;
const DISCOVERY_TTL_MS = 6 * 60 * 60 * 1000;

type PoolRef = { id: string; inputTokens: { id: string }[] };

type DiscoveryData = { liquidityPools: PoolRef[] };

type ActivityData = {
  dexAmmProtocols: { schemaVersion: string; totalValueLockedUSD: string }[];
  liquidityPools: (PoolRef & { name: string | null; totalValueLockedUSD: string })[];
  liquidityPoolDailySnapshots: {
    pool: { id: string };
    dailyVolumeUSD: string;
    dailyTotalRevenueUSD: string;
  }[];
  _meta: { block: { number: number; timestamp: number | null } };
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
  /** When this data was fetched from The Graph. */
  fetchedAt: string;
  /** True when the live fetch was slow or failed and the last good result was used. */
  stale: boolean;
  /** Where the pool universe came from: live discovery or the checked-in seed list. */
  poolSource: "discovered" | "seed";
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

const isBlueChip = (pool: PoolRef) =>
  pool.inputTokens.every((t) => t.id in ETHEREUM_BLUE_CHIP_TOKENS);

const discovered = new Map<string, { ids: string[]; at: number }>();
const discovering = new Map<string, Promise<void>>();

function refreshDiscovery(deployment: DexDeployment): Promise<void> {
  const running = discovering.get(deployment.key);
  if (running) {
    return running;
  }
  const job = queryGraph<DiscoveryData>(deployment.subgraphId, DISCOVERY_QUERY, {
    first: CANDIDATE_POOLS,
  })
    .then((data) => {
      const ids = data.liquidityPools
        .filter(isBlueChip)
        .slice(0, MAX_BLUE_CHIP_POOLS)
        .map((p) => p.id);
      if (ids.length > 0) {
        discovered.set(deployment.key, { ids, at: Date.now() });
      }
    })
    .catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[dex] pool discovery failed for ${deployment.key}: ${message}`);
    })
    .finally(() => discovering.delete(deployment.key));
  discovering.set(deployment.key, job);
  return job;
}

/**
 * The blue-chip pools to measure. Never waits on the slow discovery query when
 * a previous discovery or the seed list can answer; stale entries refresh in
 * the background.
 */
async function poolUniverse(
  deployment: DexDeployment,
): Promise<{ ids: string[]; source: DexActivity["poolSource"] }> {
  const hit = discovered.get(deployment.key);
  const seed = SEED_BLUE_CHIP_POOLS[deployment.key] ?? [];
  if (!hit || Date.now() - hit.at > DISCOVERY_TTL_MS) {
    const job = refreshDiscovery(deployment);
    if (!hit && seed.length === 0) {
      await job;
    }
  }
  const current = discovered.get(deployment.key);
  return current ? { ids: current.ids, source: "discovered" } : { ids: [...seed], source: "seed" };
}

async function fetchActivity(deployment: DexDeployment, days: number): Promise<DexActivity> {
  const universe = await poolUniverse(deployment);
  if (universe.ids.length === 0) {
    throw new Error("no blue-chip pools known for this deployment");
  }

  const since = String(Math.floor(Date.now() / 1000) - days * 86_400);
  const data = await queryGraph<ActivityData>(deployment.subgraphId, ACTIVITY_QUERY, {
    pools: universe.ids,
    since,
  });
  const protocol = data.dexAmmProtocols[0];
  if (!protocol) {
    throw new Error("subgraph returned no dexAmmProtocol entity");
  }

  const pools = data.liquidityPools.filter(isBlueChip);
  const snapshots = data.liquidityPoolDailySnapshots;

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
  const blockTime = data._meta.block.timestamp;

  return {
    deployment: deployment.key,
    protocol: deployment.protocol,
    network: deployment.network,
    schemaVersion: protocol.schemaVersion,
    days,
    fetchedAt: new Date().toISOString(),
    stale: false,
    poolSource: universe.source,
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
    indexedBlock: data._meta.block.number,
    indexedAt: blockTime ? new Date(blockTime * 1000).toISOString() : null,
  };
}

// The MCP tools and the quorum often ask for the same data back to back.
const cache = new Map<string, { expires: number; value: Promise<DexActivity> }>();
const lastGood = new Map<string, DexActivity>();

function getActivity(deployment: DexDeployment, days: number): Promise<DexActivity> {
  const key = `${deployment.key}:${days}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) {
    return hit.value;
  }
  const value = fetchActivity(deployment, days);
  cache.set(key, { expires: Date.now() + CACHE_TTL_MS, value });
  value.then(
    (activity) => lastGood.set(key, activity),
    () => cache.delete(key),
  );
  return value;
}

function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out after ${ms / 1000}s`)), ms);
    timer.unref?.();
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * Live activity within a deadline; if the live fetch is slow or fails, the last good
 * result (at most 30 minutes old) marked `stale`. A slow fetch keeps running and
 * refreshes the last good result when it lands.
 */
async function freshOrLastGood(deployment: DexDeployment, days: number): Promise<DexActivity> {
  try {
    return await withDeadline(getActivity(deployment, days), DEPLOYMENT_DEADLINE_MS);
  } catch (err) {
    const previous = lastGood.get(`${deployment.key}:${days}`);
    if (previous && Date.now() - Date.parse(previous.fetchedAt) <= STALE_MAX_AGE_MS) {
      return { ...previous, stale: true };
    }
    throw err;
  }
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
  const settled = await Promise.allSettled(deployments.map((d) => freshOrLastGood(d, days)));

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
    method: `Per protocol: pools whose every token is on the blue-chip allowlist (max ${MAX_BLUE_CHIP_POOLS}), discovered from the top ${CANDIDATE_POOLS} pools by cumulative volume and refreshed in the background, with a checked-in seed list as fallback. TVL is read live from each pool; window volume and revenue are summed from live daily snapshots.`,
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
  const activity = await freshOrLastGood(deployment, days);
  return activity.topPools.slice(0, first);
}
