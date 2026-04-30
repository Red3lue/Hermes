import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });
import Anthropic from "@anthropic-ai/sdk";

const KEY = process.env.ANTHROPIC_API_KEY;

async function main() {
  if (!KEY) {
    console.error("✗ ANTHROPIC_API_KEY missing in .env");
    process.exit(1);
  }
  console.log(`key prefix: ${KEY.slice(0, 12)}...  (length: ${KEY.length})`);

  const client = new Anthropic({ apiKey: KEY });

  console.log("calling claude-haiku-4-5-20251001...");
  const t0 = Date.now();
  const resp = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 64,
    messages: [{ role: "user", content: "Reply with the single word: pong" }],
  });
  const dt = Date.now() - t0;

  const block = resp.content[0];
  const text = block?.type === "text" ? block.text : "(non-text response)";
  console.log(`✓ response in ${dt}ms: ${text.trim()}`);
  console.log(
    `tokens — input: ${resp.usage.input_tokens}, output: ${resp.usage.output_tokens}`,
  );
  console.log("model:", resp.model);
  console.log("stop_reason:", resp.stop_reason);
}

main().catch((e) => {
  console.error("✗ failed:", e.message ?? e);
  process.exit(1);
});
