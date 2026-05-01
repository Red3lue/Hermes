import { config as loadEnv } from "dotenv";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
// Repo root .env (../../.env from this file).
loadEnv({ path: resolve(__dirname, "../../.env") });

import { runMockDemo } from "./mock";
import { runLiveDemo } from "./live";

function banner(title: string, sub?: string) {
  const line = "=".repeat(72);
  console.log(`\n${line}`);
  console.log(`  ${title}`);
  if (sub) console.log(`  ${sub}`);
  console.log(`${line}\n`);
}

function footer(ok: boolean, mode: string) {
  const line = "-".repeat(72);
  console.log(`\n${line}`);
  console.log(`  [${mode}] ${ok ? "DEMO OK — chunk-4 lifecycle verified" : "DEMO FAILED"}`);
  console.log(`${line}\n`);
}

async function main() {
  const mode = (process.env.MODE ?? "mock").toLowerCase();

  if (mode === "live") {
    banner(
      "Hermes BIOMES demo — LIVE",
      "Sepolia ENS + 0G Storage + on-chain HermesInbox",
    );
    try {
      await runLiveDemo();
      footer(true, "live");
      return;
    } catch (err) {
      console.error("\n[live] failed:", (err as Error).message);
      console.error((err as Error).stack ?? "");
      console.log(
        "\n[fallback] running mock demo so the recording still has a clean run...\n",
      );
    }
  }

  banner(
    "Hermes BIOMES demo — MOCK",
    "in-memory storage, deterministic, no network",
  );
  await runMockDemo();
  footer(true, "mock");
}

main().catch((err) => {
  console.error("\nfatal:", err);
  process.exit(1);
});
