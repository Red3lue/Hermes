// Live-data check without an MCP client: pnpm --filter @hermes/mcp-server smoke
import { compareDexProtocols } from "./dex.js";
import { loadRootEnv } from "./env.js";

loadRootEnv();

const result = await compareDexProtocols([], 7);
console.log(JSON.stringify(result, null, 2));
if (result.protocols.length === 0) {
  process.exit(1);
}
