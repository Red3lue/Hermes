import { callLLM } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler, RuntimeContext } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type SelectorBody } from "./envelopes.js";

const ROUND_TIMEOUT_MS = 90_000;
const ROUTE_FORMAT_NOTE = `Reply with a SINGLE compact JSON object on one line:
{"expertEns": "<one of the experts you know>", "reason": "<one short sentence>", "contextForExpert": "<the user question, optionally restated for clarity>"}
Do not include any prose outside the JSON. Do not wrap it in code fences.`;

type RoundState = {
  requestId: string;
  requesterEns: string;
  userMarkdown: string;
  startedAt: number;
  expertEns?: string;
  reason?: string;
  finalSent: boolean;
};

export type SelectorOpts = {
  /** ENS list of every expert this selector can route to. Used as a hard
   * allowlist in case the LLM hallucinates a non-existent ENS. */
  experts: AgentDef[];
};

/** Best-effort JSON extraction — handles fenced code blocks, leading
 * prose, etc. Returns null if no parseable object is found. */
function tryParseRouting(
  text: string,
): { expertEns?: string; reason?: string; contextForExpert?: string } | null {
  // Strip fences if present
  const cleaned = text
    .replace(/```(?:json)?\s*/gi, "")
    .replace(/```/g, "")
    .trim();
  // Find the first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

export function makeSelectorHandler(
  agent: AgentDef,
  opts: SelectorOpts,
): RoleHandler {
  const rounds = new Map<string, RoundState>();

  async function startRound(
    requestId: string,
    userMarkdown: string,
    requesterEns: string,
    ctx: RuntimeContext,
  ) {
    if (rounds.has(requestId)) return;
    const state: RoundState = {
      requestId,
      requesterEns,
      userMarkdown,
      startedAt: Date.now(),
      finalSent: false,
    };
    rounds.set(requestId, state);
    console.log(
      `[selector] new request ${requestId.slice(0, 8)} from ${requesterEns}`,
    );

    // Pull own Anima — this is the routing manifest. The Selector's whole
    // job is to read this and pick one expert.
    const souls = await ctx.resolveSouls();
    if (!souls.anima) {
      console.warn(
        `[selector] no Anima published for ${agent.ens}; cannot route`,
      );
      await sendFinal(
        state,
        ctx,
        "(selector misconfigured: no routing Anima published)",
        "",
        "",
      );
      return;
    }

    const knownExpertList = opts.experts
      .map((e) => `- ${e.ens}`)
      .join("\n");

    const extraSystem = [
      `## Your Anima — your routing manifest (the soul that tells you who to ask)`,
      souls.anima,
      `\n## Hard allowlist of expert ENS names`,
      `You may only route to one of these. If none fits, pick the closest match.`,
      knownExpertList,
      `\n## Output format`,
      ROUTE_FORMAT_NOTE,
    ].join("\n\n");

    let llmReply: string;
    try {
      llmReply = await callLLM({
        persona: agent.persona,
        extraSystemContent: extraSystem,
        history: [],
        userPrompt: userMarkdown,
        maxTokens: 240,
      });
    } catch (err) {
      console.warn(`[selector] LLM error:`, (err as Error).message);
      return;
    }

    const parsed = tryParseRouting(llmReply);
    let expertEns = parsed?.expertEns?.trim() ?? "";
    const reason = parsed?.reason?.trim() ?? "(no reason given)";
    const contextForExpert =
      parsed?.contextForExpert?.trim() || userMarkdown;

    // Validate against the hard allowlist; coerce to closest known expert
    // if the LLM gave us something that's not in our list.
    const valid = opts.experts.find(
      (e) => e.ens.toLowerCase() === expertEns.toLowerCase(),
    );
    if (!valid) {
      console.warn(
        `[selector] LLM routed to "${expertEns}" not in allowlist — falling back to ${opts.experts[0].ens}`,
      );
      expertEns = opts.experts[0].ens;
    }

    state.expertEns = expertEns;
    state.reason = reason;

    // Forward to the picked expert
    const exReq: SelectorBody = {
      kind: "expert-request",
      requestId,
      markdown: contextForExpert,
      requesterEns,
      reason,
    };
    try {
      await ctx.sendDM(expertEns, encodeBody(exReq));
      console.log(
        `[selector] routed ${requestId.slice(0, 8)} → ${expertEns} (${reason.slice(0, 60)})`,
      );
    } catch (err) {
      console.warn(
        `[selector] expert dispatch failed:`,
        (err as Error).message,
      );
      return;
    }

    // Timeout fallback — if the expert never replies, tell the user.
    setTimeout(() => {
      const cur = rounds.get(requestId);
      if (cur && !cur.finalSent) {
        console.log(`[selector] ${requestId.slice(0, 8)} expert timeout`);
        sendFinal(
          cur,
          ctx,
          `(${expertEns} did not respond within ${ROUND_TIMEOUT_MS / 1000}s)`,
          expertEns,
          reason,
        );
      }
    }, ROUND_TIMEOUT_MS);
  }

  async function handleExpertReply(
    body: Extract<SelectorBody, { kind: "expert-reply" }>,
    senderEns: string,
    ctx: RuntimeContext,
  ) {
    const state = rounds.get(body.requestId);
    if (!state) {
      console.warn(
        `[selector] expert-reply for unknown request ${body.requestId.slice(0, 8)}`,
      );
      return;
    }
    if (state.finalSent) return;

    // Compose the user-visible final response. Mode B (transparent
    // routing) — surfaces which expert was picked + why + a footer
    // letting the user know they can DM the expert directly.
    const expertEns = body.expertEns;
    const reason = state.reason ?? "(no reason recorded)";
    const composed = [
      `**Routed to** \`${expertEns}\` — ${reason}`,
      ``,
      body.markdown.trim(),
      ``,
      `---`,
      `_You can DM \`${expertEns}\` directly any time for a follow-up._`,
    ].join("\n");

    await sendFinal(state, ctx, composed, expertEns, reason);
  }

  async function sendFinal(
    state: RoundState,
    ctx: RuntimeContext,
    markdown: string,
    expertEns: string,
    reason: string,
  ) {
    if (state.finalSent) return;
    state.finalSent = true;

    const body: SelectorBody = {
      kind: "final-response",
      requestId: state.requestId,
      markdown,
      expertEns,
      reason,
    };
    try {
      await ctx.sendDM(state.requesterEns, encodeBody(body));
      console.log(
        `[selector] ${state.requestId.slice(0, 8)} final → ${state.requesterEns}`,
      );
    } catch (err) {
      state.finalSent = false;
      console.warn(`[selector] final-response send failed:`, (err as Error).message);
    }
  }

  return {
    subscribedBiomes: [],
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      if (body.kind === "request") {
        await startRound(body.requestId, body.markdown, msg.from, ctx);
      } else if (body.kind === "expert-reply") {
        await handleExpertReply(body, msg.from, ctx);
      }
    },
  };
}
