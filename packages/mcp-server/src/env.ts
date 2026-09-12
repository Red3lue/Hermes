import { fileURLToPath } from "node:url";
import { config } from "dotenv";

// Local dev reads the repo-root .env; MCP clients pass GRAPH_API_KEY via their
// own env config, which dotenv never overrides.
export function loadRootEnv(): void {
  config({ path: fileURLToPath(new URL("../../../.env", import.meta.url)) });
}
