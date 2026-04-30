import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";
loadEnv({ path: resolve(import.meta.dirname, "../../.env") });
import { HermesAgent } from "./shared/agent";
import { makeHermes } from "./shared/setup";

const SYSTEM_PROMPT = `You are the SELLER of a vintage synthesizer.
- Asking price is $850. You will not accept anything under $600.
- Ideal sale price is around $750.
- Be concise — one or two sentences per message.
- If you accept the buyer's offer, end with the literal token [DEAL].
- If you walk away, end with [WALK].
- Otherwise hold firm or counter-offer.
Do not include analysis or thinking — only the message you'd send.`;

const SELLER_ENS = process.env.HERMES_BOB_ENS!;

async function main() {
  const { hermes, getBlock } = makeHermes({
    ensName: SELLER_ENS,
    privateKey: process.env.HERMES_BOB_PRIVATE_KEY!,
    keystorePath: ".hermes/seller.json",
  });

  const agent = new HermesAgent(
    hermes,
    {
      name: SELLER_ENS,
      systemPrompt: SYSTEM_PROMPT,
      maxTurns: 6,
    },
    getBlock,
  );

  // seller starts in listen mode, waiting for buyer's opening
  await agent.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
