import type { AgentDef } from "../registry.js";
import type { RoleHandler, RuntimeContext } from "../runtime/agentRuntime.js";
import { decodeBody, encodeBody, type QuorumBody } from "./envelopes.js";

const ROUND_TIMEOUT_MS = 90_000;

type RoundState = {
  contextId: string; // === requestId
  contextMarkdown: string;
  requesterEns: string; // user ENS that submitted via DM
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
  finalSent: boolean;
};

export type CoordinatorOpts = {
  biomeName: string;
  members: AgentDef[]; // quorum members (currently 3: architect, skeptic, pragmatist)
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
      tallied: false,
      bundleSent: false,
      finalSent: false,
    };
    rounds.set(requestId, state);
    console.log(
      `[coordinator] new round ${requestId.slice(0, 8)} from ${requesterEns}`,
    );

    // Broadcast started stage on the biome (member-visible only)
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

    // Fan out deliberate to each member (DM, encrypted to member pubkey)
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

    // Schedule timeout
    setTimeout(() => {
      const cur = rounds.get(requestId);
      if (cur && !cur.tallied) {
        console.log(
          `[coordinator] ${requestId.slice(0, 8)} timeout reached`,
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

  async function handleReport(
    body: Extract<QuorumBody, { kind: "report" }>,
    ctx: RuntimeContext,
  ) {
    const state = rounds.get(body.contextId);
    if (!state) return; // not our round
    if (state.finalSent) return;
    state.finalSent = true;

    const finalBody: QuorumBody = {
      kind: "final-response",
      requestId: body.contextId,
      markdown: body.markdown,
      tally: body.tally,
    };
    try {
      await ctx.sendDM(state.requesterEns, encodeBody(finalBody));
      console.log(
        `[coordinator] ${body.contextId.slice(0, 8)} final-response → ${state.requesterEns}`,
      );
    } catch (err) {
      state.finalSent = false;
      console.warn(
        `[coordinator] final-response send failed:`,
        (err as Error).message,
      );
    }
  }

  return {
    subscribedBiomes: [opts.biomeName],
    onBiome: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      // The coordinator listens to biome broadcasts only to pick up the
      // reporter's `report` and trigger the final-response DM to the user.
      if (body.kind === "report") {
        await handleReport(body, ctx);
      }
      // All other biome broadcasts are stages emitted by the coordinator
      // itself or read-only telemetry; ignore.
    },
    onDM: async (msg, ctx) => {
      const body = decodeBody(msg.text);
      if (!body) return;
      if (body.kind === "request") {
        // Public user → coordinator. msg.from is the user's ENS, sealed
        // for the coordinator's pubkey by the SDK on the user's side.
        await startRound(body.requestId, body.markdown, msg.from, ctx);
      } else if (body.kind === "verdict") {
        await handleVerdict(body, msg.from, ctx);
      }
    },
  };
}
