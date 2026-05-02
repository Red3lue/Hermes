import { callLLM } from "../llm.js";
import type { AgentDef } from "../registry.js";
import type { RoleHandler, RuntimeContext } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type QuorumBody } from "./envelopes.js";

const ROUND_TIMEOUT_MS = 90_000;

type RoundState = {
  contextId: string; // === requestId
  contextMarkdown: string;
  requesterEns: string;
  startedAt: number;
  members: AgentDef[];
  verdicts: Map<
    string,
    {
      slug: string;
      ens: string;
      text: string;
      verdict: "agree" | "disagree" | "abstain";
    }
  >;
  finalized: boolean;
  finalSent: boolean;
};

export type CoordinatorOpts = {
  biomeName: string;
  members: AgentDef[];
};

export function makeCoordinatorHandler(
  agent: AgentDef,
  opts: CoordinatorOpts,
): RoleHandler {
  const rounds = new Map<string, RoundState>();

  async function synthesizeAndReply(
    state: RoundState,
    ctx: RuntimeContext,
    reason: "all-replied" | "timeout",
  ) {
    if (state.finalized) return;
    state.finalized = true;

    const tally = { agree: 0, disagree: 0, abstain: 0 } as Record<
      string,
      number
    >;
    for (const v of state.verdicts.values()) tally[v.verdict]++;

    console.log(
      `[coordinator] ${state.contextId.slice(0, 8)} synthesizing: ${JSON.stringify(tally)} (${reason})`,
    );

    const memberBlock = [...state.verdicts.values()]
      .map(
        (v) =>
          `### ${v.slug} — VERDICT: ${v.verdict}\n${v.text.replace(/VERDICT:.*$/i, "").trim()}`,
      )
      .join("\n\n");

    // Pull souls — own anima + biome animus — before synthesising.
    const souls = await ctx.resolveSouls({ biomeName: opts.biomeName });
    const extraSystemParts: string[] = [];
    if (souls.anima) {
      extraSystemParts.push(
        `## Your Anima (your soul, owner-published context)\n${souls.anima}`,
      );
    }
    if (souls.animus) {
      extraSystemParts.push(
        `## Biome Animus (the biome's shared soul — sealed for members only)\n${souls.animus}`,
      );
    }
    const extraSystem =
      extraSystemParts.length > 0 ? extraSystemParts.join("\n\n") : undefined;

    const userPrompt = [
      `## Original question\n${state.contextMarkdown}`,
      `## Member responses\n${memberBlock || "(no responses received)"}`,
      `## Tally\nagree: ${tally.agree}, disagree: ${tally.disagree}, abstain: ${tally.abstain}`,
      "Now produce the final synthesis report following your persona.",
    ].join("\n\n");

    let markdown: string;
    try {
      markdown = await callLLM({
        persona: agent.persona,
        extraSystemContent: extraSystem,
        history: [],
        userPrompt,
        maxTokens: 600,
      });
    } catch (err) {
      console.warn(
        `[coordinator] LLM synthesis failed:`,
        (err as Error).message,
      );
      markdown =
        `# Quorum result\n\nThe quorum returned **${tally.agree} agree / ${tally.disagree} disagree / ${tally.abstain} abstain** ` +
        `on:\n\n> ${state.contextMarkdown}\n\n(Synthesis LLM unavailable; raw verdicts:)\n\n${memberBlock}`;
    }

    if (state.finalSent) return;
    state.finalSent = true;

    const finalBody: QuorumBody = {
      kind: "final-response",
      requestId: state.contextId,
      markdown,
      tally,
    };
    try {
      await ctx.sendDM(state.requesterEns, encodeBody(finalBody));
      console.log(
        `[coordinator] ${state.contextId.slice(0, 8)} final-response → ${state.requesterEns}`,
      );
    } catch (err) {
      state.finalSent = false;
      console.warn(
        `[coordinator] final-response send failed:`,
        (err as Error).message,
      );
    }
  }

  async function startRound(
    requestId: string,
    markdown: string,
    requesterEns: string,
    ctx: RuntimeContext,
  ) {
    if (rounds.has(requestId)) return;

    const state: RoundState = {
      contextId: requestId,
      contextMarkdown: markdown,
      requesterEns,
      startedAt: Date.now(),
      members: opts.members,
      verdicts: new Map(),
      finalized: false,
      finalSent: false,
    };
    rounds.set(requestId, state);
    console.log(
      `[coordinator] new round ${requestId.slice(0, 8)} from ${requesterEns}`,
    );

    // Stage broadcast on the biome (member-visible only).
    const startedBody: QuorumBody = {
      kind: "stage",
      stage: "started",
      contextId: requestId,
      meta: {
        requesterEns,
        members: opts.members.map((m) => m.ens),
      },
    };
    await ctx.broadcast(opts.biomeName, encodeBody(startedBody));

    // Fan out deliberate DMs to each member (sequential — shared deployer
    // wallet collides on parallel sends).
    for (const member of opts.members) {
      const delibBody: QuorumBody = {
        kind: "deliberate",
        contextId: requestId,
        contextMarkdown: markdown,
      };
      try {
        await ctx.sendDM(member.ens, encodeBody(delibBody));
        console.log(`[coordinator] dispatched to ${member.slug}`);
      } catch (err) {
        console.warn(
          `[coordinator] dispatch to ${member.slug} failed:`,
          (err as Error).message,
        );
      }
    }

    // Round timeout — finalize with whatever verdicts we have.
    setTimeout(() => {
      const cur = rounds.get(requestId);
      if (cur && !cur.finalized) {
        console.log(
          `[coordinator] ${requestId.slice(0, 8)} timeout reached`,
        );
        synthesizeAndReply(cur, ctx, "timeout");
      }
    }, ROUND_TIMEOUT_MS);
  }

  async function handleVerdict(
    body: Extract<QuorumBody, { kind: "verdict" }>,
    senderEns: string,
    ctx: RuntimeContext,
  ) {
    const state = rounds.get(body.contextId);
    if (!state) {
      console.warn(
        `[coordinator] verdict for unknown contextId ${body.contextId.slice(0, 8)}`,
      );
      return;
    }
    if (state.verdicts.has(body.slug)) return;
    state.verdicts.set(body.slug, {
      slug: body.slug,
      ens: senderEns,
      text: body.text,
      verdict: body.verdict,
    });
    console.log(
      `[coordinator] ${body.contextId.slice(0, 8)} verdict from ${body.slug}: ${body.verdict} (${state.verdicts.size}/${state.members.length})`,
    );

    // Stage broadcast (member-visible only).
    const stageBody: QuorumBody = {
      kind: "stage",
      stage: "member-replied",
      contextId: body.contextId,
      meta: { slug: body.slug, ens: senderEns, verdict: body.verdict },
    };
    await ctx.broadcast(opts.biomeName, encodeBody(stageBody));

    if (state.verdicts.size >= state.members.length) {
      await synthesizeAndReply(state, ctx, "all-replied");
    }
  }

  return {
    subscribedBiomes: [opts.biomeName],
    onBiome: async () => {
      // Coordinator no longer reacts to biome broadcasts. It still
      // subscribes so its policy is correct; ignore the messages.
    },
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      if (body.kind === "request") {
        await startRound(body.requestId, body.markdown, msg.from, ctx);
      } else if (body.kind === "verdict") {
        await handleVerdict(body, msg.from, ctx);
      }
    },
  };
}
