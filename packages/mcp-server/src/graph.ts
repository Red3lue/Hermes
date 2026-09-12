const GATEWAY_URL = "https://gateway.thegraph.com/api/subgraphs/id";
const TIMEOUT_MS = 45_000;

export class GraphQueryError extends Error {
  constructor(
    message: string,
    readonly subgraphId: string,
  ) {
    super(message);
    this.name = "GraphQueryError";
  }
}

type GraphResponse<T> = { data?: T; errors?: { message: string }[] };

/**
 * Runs a GraphQL query against a subgraph on The Graph Network via the gateway.
 * Retries once when the gateway reports indexer-side failures ("bad indexers"),
 * since it routes the retry to other indexers.
 */
export async function queryGraph<T>(
  subgraphId: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  try {
    return await queryOnce<T>(subgraphId, query, variables);
  } catch (err) {
    if (err instanceof GraphQueryError && err.message.startsWith("bad indexers")) {
      return queryOnce<T>(subgraphId, query, variables);
    }
    throw err;
  }
}

async function queryOnce<T>(
  subgraphId: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<T> {
  const apiKey = process.env.GRAPH_API_KEY;
  if (!apiKey) {
    throw new GraphQueryError("GRAPH_API_KEY is not set", subgraphId);
  }

  const res = await fetch(`${GATEWAY_URL}/${subgraphId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) {
    throw new GraphQueryError(`Graph gateway HTTP ${res.status}`, subgraphId);
  }

  // The gateway reports auth and query errors with HTTP 200.
  const body = (await res.json()) as GraphResponse<T>;
  if (body.errors?.length) {
    throw new GraphQueryError(body.errors.map((e) => e.message).join("; "), subgraphId);
  }
  if (!body.data) {
    throw new GraphQueryError("Graph gateway returned no data", subgraphId);
  }
  return body.data;
}
