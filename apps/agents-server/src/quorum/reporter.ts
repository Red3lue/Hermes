import { callLLM } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type QuorumBody } from "./envelopes.js";

export function makeReporterHandler(
  agent: AgentDef,
  opts: { biomeName: string; coordinatorEns: string },
): RoleHandler {
  const reported = new Set<string>();

  return {
    subscribedBiomes: [opts.biomeName],
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body || body.kind !== "bundle") return;
      if (reported.has(body.contextId)) return;
      if (msg.from !== opts.coordinatorEns) {
        console.warn(
          `[reporter] ignoring bundle from non-coordinator ${msg.from}`,
        );
        return;
      }

      const tally = { agree: 0, disagree: 0, abstain: 0 } as Record<
        string,
        number
      >;
      for (const v of body.verdicts) tally[v.verdict]++;

      const memberBlock = body.verdicts
        .map(
          (v) =>
            `### ${v.slug} — VERDICT: ${v.verdict}\n${v.text.replace(/VERDICT:.*$/i, "").trim()}`,
        )
        .join("\n\n");

      const userPrompt = [
        `## Original question\n${body.contextMarkdown}`,
        `## Member responses\n${memberBlock}`,
        `## Tally\nagree: ${tally.agree}, disagree: ${tally.disagree}, abstain: ${tally.abstain}`,
        "Now produce the final report following your persona's exact structure.",
      ].join("\n\n");

      let markdown: string;
      try {
        markdown = await callLLM({
          persona: agent.persona,
          history: [],
          userPrompt,
          maxTokens: 600,
        });
      } catch (err) {
        console.warn(`[reporter] LLM error:`, (err as Error).message);
        return;
      }

      const reportBody: QuorumBody = {
        kind: "report",
        contextId: body.contextId,
        markdown,
        tally,
      };
      try {
        await ctx.broadcast(opts.biomeName, encodeBody(reportBody));
        reported.add(body.contextId);
        console.log(
          `[reporter] report posted for ${body.contextId.slice(0, 8)}`,
        );

        // Also broadcast a final stage marker so the FE timeline closes
        const stageBody: QuorumBody = {
          kind: "stage",
          stage: "report-posted",
          contextId: body.contextId,
          meta: { tally },
        };
        await ctx.broadcast(opts.biomeName, encodeBody(stageBody));
      } catch (err) {
        console.warn(`[reporter] broadcast failed:`, (err as Error).message);
      }
    },
  };
}
