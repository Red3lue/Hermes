import { callLLM } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type SelectorBody } from "./envelopes.js";

const MAX_TOKENS = 600;

export function makeExpertHandler(
  agent: AgentDef,
  opts: { selectorEns: string },
): RoleHandler {
  // Per-request idempotency — never reply twice on retries / restarts.
  const replied = new Set<`0x${string}`>();

  return {
    subscribedBiomes: [],
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body || body.kind !== "expert-request") return;
      if (replied.has(msg.rootHash)) return;
      replied.add(msg.rootHash);

      // Only respond to expert-requests from the configured selector;
      // expert agents are still publicly addressable for direct user DMs
      // but the routed flow is selector-only.
      if (msg.from !== opts.selectorEns) {
        // For demo simplicity: if a user DM'd the expert directly with a
        // SelectorBody (unlikely), we still answer back to the sender.
        console.warn(
          `[expert:${agent.slug}] expert-request from non-selector ${msg.from}`,
        );
      }

      // Pull own Anima — this is what makes the expert *expert* in their
      // domain. The Anima is their domain knowledge / role definition.
      const souls = await ctx.resolveSouls();
      const extraSystem = souls.anima
        ? `## Your Anima (your domain expertise + voice)\n${souls.anima}`
        : undefined;

      const userPrompt = [
        body.reason
          ? `_The selector routed this to you because: ${body.reason}_\n`
          : "",
        `${body.markdown}`,
        ``,
        `Answer in your own voice, grounded in your Anima. Keep it focused: 1–3 short paragraphs, no bullet-point overload.`,
      ].join("\n");

      let reply: string;
      try {
        reply = await callLLM({
          persona: agent.persona,
          extraSystemContent: extraSystem,
          history: [],
          userPrompt,
          maxTokens: MAX_TOKENS,
        });
      } catch (err) {
        console.warn(
          `[expert:${agent.slug}] LLM error:`,
          (err as Error).message,
        );
        replied.delete(msg.rootHash);
        return;
      }

      const out: SelectorBody = {
        kind: "expert-reply",
        requestId: body.requestId,
        markdown: reply,
        expertEns: agent.ens,
      };
      try {
        await ctx.sendDM(msg.from, encodeBody(out));
        console.log(
          `[expert:${agent.slug}] replied to selector for ${body.requestId.slice(0, 8)}`,
        );
      } catch (err) {
        replied.delete(msg.rootHash);
        console.warn(
          `[expert:${agent.slug}] reply send failed:`,
          (err as Error).message,
        );
      }
    },
  };
}
