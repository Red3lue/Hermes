import { config as loadEnv } from "dotenv";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../.env") });
loadEnv({ path: resolve(__dirname, "../../../.env") }); // fallback to repo root .env

import express from "express";
import cors from "cors";
import { loadAgents } from "./registry.js";
import { agentsRouter } from "./routes/agents.js";
import { proxy0gRouter } from "./routes/proxy0g.js";
import { registerRouter } from "./routes/register.js";
import { contextRouter } from "./routes/context.js";
import { bootQuorum } from "./quorum/index.js";
import { bootChatbot } from "./chatbot/index.js";
import { bootSelector } from "./selector/index.js";

const PORT = Number(process.env.PORT ?? 8787);
const QUORUM_BIOME =
  process.env.QUORUM_BIOME_NAME ?? "quorumv2.biomes.hermes.eth";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

// All quorum/chatbot/context HTTP routes are GONE — those flows now run
// entirely on chain (0G + Sepolia HermesInbox). The HTTP surface that
// remains is metadata-only:
app.use("/agents", agentsRouter); // GET /agents — read-only persona/ENS lookup
app.use("/biome", contextRouter); // GET /biome/:name/resolve — read-only BiomeDoc resolver
app.use(proxy0gRouter); // 0G upload/download proxy (used by FE to bypass CORS)
app.use(registerRouter); // POST /register-user — one-time ENS subname mint

async function bootstrap() {
  const agents = loadAgents();
  console.log(`[boot] ${agents.length} agents loaded`);

  // Boot the quorum runtime: spawns the coordinator + reporter + member
  // polling loops. They watch HermesInbox on Sepolia and 0G blobs.
  try {
    await bootQuorum(QUORUM_BIOME);
  } catch (err) {
    console.error("[boot] quorum boot failed:", (err as Error).message);
    console.error(
      "       The HTTP server will still start, but no quorum agents are listening.",
    );
  }

  // Boot the chatbot runtime: the concierge agent that handles 1:1
  // sealed DMs from any user.
  try {
    await bootChatbot();
  } catch (err) {
    console.error("[boot] chatbot boot failed:", (err as Error).message);
  }

  // Boot the selector demo: a routing agent (Selector) reads its Anima
  // as a routing manifest and dispatches each user request to the right
  // domain expert.
  try {
    await bootSelector();
  } catch (err) {
    console.error("[boot] selector boot failed:", (err as Error).message);
  }
}

bootstrap();

app.listen(PORT, () => {
  console.log(`[agents-server] listening on http://localhost:${PORT}`);
});
