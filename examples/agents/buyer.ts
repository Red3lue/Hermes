import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });
import { HermesAgent } from "./shared/agent";
import { makeHermes } from "./shared/setup";

const SYSTEM_PROMPT = `You are the BUYER negotiating to purchase a vintage synthesizer.
- Your max budget is $700. Never go above it.
- You'd ideally pay around $500.
- Be concise — one or two sentences per message.
- If you accept the seller's price, end with the literal token [DEAL].
- If you walk away, end with [WALK].
- Otherwise propose a counter-offer.
Do not include analysis or thinking — only the message you'd send.`;

const BUYER_ENS = process.env.HERMES_ALICE_ENS!;
const SELLER_ENS = process.env.HERMES_BOB_ENS!;

async function main() {
  const { hermes, getBlock } = makeHermes({
    ensName: BUYER_ENS,
    privateKey: process.env.HERMES_ALICE_PRIVATE_KEY!,
    keystorePath: ".hermes/buyer.json",
  });

  const agent = new HermesAgent(
    hermes,
    {
      name: BUYER_ENS,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 6,
    },
    getBlock,
  );

  await agent.start({
    to: SELLER_ENS,
    text: "Hi, I'm interested in the synth. What's your asking price?",
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
