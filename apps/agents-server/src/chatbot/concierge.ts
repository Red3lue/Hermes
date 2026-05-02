import { callLLM, type Turn } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler } from "../runtime/agentRuntime.js";

// Cap conversation history at this many turn-pairs per sender.
const HISTORY_CAP_PAIRS = 10;
const MAX_TOKENS = 600;

export function makeConciergeHandler(agent: AgentDef): RoleHandler {
  // Per-sender conversation history. Keyed by sender ENS.
  const histories = new Map<string, Turn[]>();
  // Idempotency — once we've replied to a particular inbound rootHash,
  // never reply twice on retries / restarts of the polling loop.
  const replied = new Set<`0x${string}`>();

  return {
    subscribedBiomes: [],
    onDM: async (msg, ctx) => {
      if (msg.from === agent.ens) return; // ignore self-DM (defensive)
      if (replied.has(msg.rootHash)) return;
      replied.add(msg.rootHash);

      const userText = (msg.text ?? "").trim();
      if (!userText) return;

      // Pull own Anima for grounding context (Animus n/a — no biome here).
      const souls = await ctx.resolveSouls();
      const extraSystem = souls.anima
        ? `## Your Anima (your soul, owner-published context)\n${souls.anima}`
        : undefined;

      // Append the new user turn to history before calling.
      const history: Turn[] = histories.get(msg.from)?.slice() ?? [];

      let reply: string;
      try {
        reply = await callLLM({
          persona: agent.persona,
          extraSystemContent: extraSystem,
          history,
          userPrompt: userText,
          maxTokens: MAX_TOKENS,
        });
      } catch (err) {
        console.warn(
          `[concierge] LLM error for ${msg.from}:`,
          (err as Error).message,
        );
        return;
      }

      // Persist the turn pair, trim to cap.
      history.push(
        { role: "user", content: userText },
        { role: "assistant", content: reply },
      );
      while (history.length > HISTORY_CAP_PAIRS * 2) history.shift();
      histories.set(msg.from, history);

      // Sealed reply DM (sealed to user's pubkey via SDK send).
      try {
        await ctx.sendDM(msg.from, reply);
        console.log(
          `[concierge] replied to ${msg.from}: ${reply.slice(0, 60)}…`,
        );
      } catch (err) {
        // If send fails, allow a future tick to retry by clearing the
        // replied flag.
        replied.delete(msg.rootHash);
        console.warn(
          `[concierge] reply send failed:`,
          (err as Error).message,
        );
      }
    },
  };
}
