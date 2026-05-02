import type { AgentDef } from "../registry.js";
import type { RoleHandler, RuntimeContext } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type QuorumBody } from "./envelopes.js";

const ROUND_TIMEOUT_MS = 90_000;

type RoundState = {
  contextId: string;
  contextMarkdown: string;
  requesterEns: string;
  startedAt: number;
  members: AgentDef[]; // dispatch list
  verdicts: Map<
    string,
    {
      slug: string;
      ens: string;
      text: string;
      verdict: "agree" | "disagree" | "abstain";
    }
  >;
  tallied: boolean;
  bundleSent: boolean;
};

export type CoordinatorOpts = {
  biomeName: string;
  members: AgentDef[]; // 5 quorum members
  reporter: AgentDef;
};

export function makeCoordinatorHandler(
  agent: AgentDef,
  opts: CoordinatorOpts,
): RoleHandler {
  // Per-contextId state
  const rounds = new Map<string, RoundState>();

  async function maybeFinalizeRound(
    state: RoundState,
    ctx: RuntimeContext,
    reason: "all-replied" | "timeout",
  ) {
    if (state.tallied) return;

    const counts = { agree: 0, disagree: 0, abstain: 0 } as Record<
      string,
      number
    >;
    for (const v of state.verdicts.values()) counts[v.verdict]++;

    const tallyBody: QuorumBody = {
      kind: "stage",
      stage: "tally",
      contextId: state.contextId,
      meta: { reason, counts, replies: state.verdicts.size },
    };
    await ctx.broadcast(opts.biomeName, encodeBody(tallyBody));
    state.tallied = true;
    console.log(
      `[coordinator] ${state.contextId.slice(0, 8)} tallied: ${JSON.stringify(counts)} (${reason})`,
    );

    // Send bundle to reporter
    if (state.bundleSent) return;
    state.bundleSent = true;
    const bundleBody: QuorumBody = {
      kind: "bundle",
      contextId: state.contextId,
      contextMarkdown: state.contextMarkdown,
      verdicts: [...state.verdicts.values()],
    };
    try {
      await ctx.sendDM(opts.reporter.ens, encodeBody(bundleBody));
      console.log(
        `[coordinator] ${state.contextId.slice(0, 8)} bundle sent to reporter`,
      );
    } catch (err) {
      console.warn(`[coordinator] bundle send failed:`, (err as Error).message);
      state.bundleSent = false;
    }
  }

  async function handleContext(
    body: Extract<QuorumBody, { kind: "context" }>,
    senderEns: string,
    ctx: RuntimeContext,
  ) {
    if (rounds.has(body.contextId)) {
      // already processing
      return;
    }

    const state: RoundState = {
      contextId: body.contextId,
      contextMarkdown: body.markdown,
      requesterEns: senderEns,
      startedAt: Date.now(),
      members: opts.members,
      verdicts: new Map(),
      tallied: false,
      bundleSent: false,
    };
    rounds.set(body.contextId, state);
    console.log(
      `[coordinator] new round ${body.contextId.slice(0, 8)} from ${senderEns}`,
    );

    // Broadcast started stage
    const startedBody: QuorumBody = {
      kind: "stage",
      stage: "started",
      contextId: body.contextId,
      meta: {
        requesterEns: senderEns,
        members: opts.members.map((m) => m.ens),
      },
    };
    await ctx.broadcast(opts.biomeName, encodeBody(startedBody));

    // Fan out deliberate to each member
    for (const member of opts.members) {
      const delibBody: QuorumBody = {
        kind: "deliberate",
        contextId: body.contextId,
        contextMarkdown: body.markdown,
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

    // Schedule timeout
    setTimeout(() => {
      const cur = rounds.get(body.contextId);
      if (cur && !cur.tallied) {
        console.log(
          `[coordinator] ${body.contextId.slice(0, 8)} timeout reached`,
        );
        maybeFinalizeRound(cur, ctx, "timeout");
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

    // Broadcast member-replied stage
    const stageBody: QuorumBody = {
      kind: "stage",
      stage: "member-replied",
      contextId: body.contextId,
      meta: { slug: body.slug, ens: senderEns, verdict: body.verdict },
    };
    await ctx.broadcast(opts.biomeName, encodeBody(stageBody));

    if (state.verdicts.size >= state.members.length) {
      await maybeFinalizeRound(state, ctx, "all-replied");
    }
  }

  return {
    subscribedBiomes: [opts.biomeName],
    onBiome: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      if (body.kind === "context") {
        await handleContext(body, msg.from, ctx);
      }
      // Ignore other broadcast kinds (stage, report) — coordinator doesn't react
    },
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      if (body.kind === "verdict") {
        await handleVerdict(body, msg.from, ctx);
      }
    },
  };
}
