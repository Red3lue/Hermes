import { fallback, http, type Transport } from "viem";

/**
 * Sepolia transport from SEPOLIA_RPC_URL, which may list several endpoints
 * separated by commas (put a keyed provider first). With more than one, viem
 * moves on to the next endpoint when a call fails, rate limits included.
 * Read at call time so a .env loaded after module import still applies.
 */
export function sepoliaTransport(): Transport {
  const urls = (process.env.SEPOLIA_RPC_URL ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter(Boolean);
  if (urls.length <= 1) {
    return http(urls[0]);
  }
  return fallback(urls.map((url) => http(url)));
}
