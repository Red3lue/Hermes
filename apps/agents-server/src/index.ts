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
import { quorumRouter } from "./routes/quorum.js";
import { contextRouter } from "./routes/context.js";
import { chatbotRouter } from "./routes/chatbot.js";
import { proxy0gRouter } from "./routes/proxy0g.js";
import { getDefaultContext } from "./registry.js";
import { getStore } from "./quorum-store.js";

const PORT = Number(process.env.PORT ?? 8787);
const QUORUM_BIOME = process.env.QUORUM_BIOME_NAME ?? "quorum.hermes.eth";

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.raw({ type: "application/octet-stream", limit: "10mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, ts: Date.now() });
});

app.use("/agents", agentsRouter);
app.use("/quorum", quorumRouter);
app.use("/biome", contextRouter);
app.use("/chatbot", chatbotRouter);
app.use(proxy0gRouter);

// Seed in-memory state with default context on boot
function bootstrap() {
  const agents = loadAgents();
  console.log(`[boot] ${agents.length} agents loaded`);

  const store = getStore(QUORUM_BIOME);
  if (!store.context) {
    store.context = getDefaultContext();
    console.log(`[boot] seeded default context for biome: ${QUORUM_BIOME}`);
  }
}

bootstrap();

app.listen(PORT, () => {
  console.log(`[agents-server] listening on http://localhost:${PORT}`);
});
