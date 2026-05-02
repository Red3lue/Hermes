import { callLLM } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type QuorumBody } from "./envelopes.js";

const VERDICT_RE = /VERDICT:\s*(agree|disagree|abstain)\s*[—–-]\s*(.+)/i;

export function makeMemberHandler(
  agent: AgentDef,
  opts: { coordinatorEns: string; biomeName: string },
): RoleHandler {
  // Track contextIds we've already replied to (idempotency on duplicate
  // deliberate messages from coordinator retries).
  const replied = new Set<string>();

  return {
    subscribedBiomes: [opts.biomeName], // members watch the biome too so
                                        // they could see context broadcasts
                                        // for read-only context (not used now)
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body || body.kind !== "deliberate") return;
      if (replied.has(body.contextId)) return;
      // Only act on deliberate from coordinator
      if (msg.from !== opts.coordinatorEns) {
        console.warn(
          `[member:${agent.slug}] ignoring deliberate from non-coordinator ${msg.from}`,
        );
        return;
      }

      // Pull souls before deliberating. Anima = own; Animus = biome-shared.
      // Both optional — if records aren't published, we just deliberate
      // with the persona alone.
      const souls = await ctx.resolveSouls({ biomeName: opts.biomeName });

      const extraSystemParts = [
        "You are participating in a multi-agent quorum.",
        "Respond with ONE concise paragraph (≤120 words).",
        "End with exactly: `VERDICT: <agree|disagree|abstain> — <one-line reason>`",
        "No markdown formatting, no headers.",
      ];
      if (souls.anima) {
        extraSystemParts.push(
          `\n\n## Your Anima (your soul, owner-published context)\n${souls.anima}`,
        );
      }
      if (souls.animus) {
        extraSystemParts.push(
          `\n\n## Biome Animus (the biome's shared soul — sealed for members only)\n${souls.animus}`,
        );
      }
      const extraSystem = extraSystemParts.join(" ");

      const userPrompt = [
        `## Context\n${body.contextMarkdown}`,
        "Write your one-paragraph response and verdict.",
      ].join("\n\n");

      let text: string;
      try {
        text = await callLLM({
          persona: agent.persona,
          extraSystemContent: extraSystem,
          history: [],
          userPrompt,
          maxTokens: 200,
        });
      } catch (err) {
        console.warn(
          `[member:${agent.slug}] LLM error:`,
          (err as Error).message,
        );
        return;
      }

      const m = text.match(VERDICT_RE);
      const verdict = (m ? m[1].toLowerCase() : "abstain") as
        | "agree"
        | "disagree"
        | "abstain";

      const verdictBody: QuorumBody = {
        kind: "verdict",
        contextId: body.contextId,
        slug: agent.slug,
        text,
        verdict,
      };
      try {
        await ctx.sendDM(opts.coordinatorEns, encodeBody(verdictBody));
        replied.add(body.contextId);
        console.log(
          `[member:${agent.slug}] verdict sent for ${body.contextId.slice(0, 8)}: ${verdict}`,
        );
      } catch (err) {
        console.warn(
          `[member:${agent.slug}] verdict send failed:`,
          (err as Error).message,
        );
      }
    },
  };
}
