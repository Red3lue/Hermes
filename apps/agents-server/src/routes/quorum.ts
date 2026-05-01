import { Router, type Router as ExpressRouter } from "express";
import { randomUUID } from "node:crypto";
import { callLLM } from "../llm.js";
import { getQuorumAgents } from "../registry.js";
import {
  getStore,
  pushEntry,
  broadcastSSE,
  addSSEClient,
  removeSSEClient,
} from "../quorum-store.js";

export const quorumRouter: ExpressRouter = Router();

const VERDICT_RE = /VERDICT:\s*(agree|disagree|abstain)\s*[—–-]\s*(.+)/i;
const RATE_LIMIT_MS = 10_000;
const lastPost = new Map<string, number>();

function canPost(slug: string): boolean {
  const last = lastPost.get(slug) ?? 0;
  return Date.now() - last >= RATE_LIMIT_MS;
}

quorumRouter.get("/:name/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const biomeName = req.params.name;
  addSSEClient(biomeName, res);

  // send current transcript on connect
  const store = getStore(biomeName);
  res.write(
    `data: ${JSON.stringify({ type: "snapshot", data: store.transcript })}\n\n`,
  );

  req.on("close", () => removeSSEClient(biomeName, res));
});

quorumRouter.post("/:name/run", async (req, res) => {
  const biomeName = req.params.name;
  const store = getStore(biomeName);

  if (store.running) {
    res.status(409).json({ error: "round already in progress" });
    return;
  }
  store.running = true;
  res.json({ ok: true, message: "round started" });

  // Run asynchronously after responding
  runRound(biomeName).finally(() => {
    store.running = false;
    broadcastSSE(biomeName, { type: "round_complete" });
  });
});

async function runRound(biomeName: string) {
  const store = getStore(biomeName);
  const agents = getQuorumAgents();

  // Shuffle for variety
  const shuffled = [...agents].sort(() => Math.random() - 0.5);

  const recentTranscript = store.transcript
    .slice(-10)
    .map((e) => `[${e.slug}]: ${e.text}`)
    .join("\n\n");

  const verdicts: { slug: string; verdict: string }[] = [];

  for (const agent of shuffled) {
    if (!canPost(agent.slug)) {
      console.log(`[quorum] rate-limiting ${agent.slug}`);
      continue;
    }

    const extraSystem = [
      "You are participating in a multi-agent deliberation. You have ONE paragraph to respond.",
      "You MUST end with exactly: `VERDICT: <agree|disagree|abstain> — <one-line reason>`",
      "Do not use markdown formatting. Be concise.",
    ].join(" ");

    const userPrompt = [
      `## Context\n${store.context || "No context set."}`,
      recentTranscript ? `## Recent transcript\n${recentTranscript}` : "",
      "Write your one-paragraph response and verdict.",
    ]
      .filter(Boolean)
      .join("\n\n");

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
      console.error(
        `[quorum] LLM error for ${agent.slug}:`,
        (err as Error).message,
      );
      continue;
    }

    const verdictMatch = text.match(VERDICT_RE);
    const verdict = verdictMatch
      ? (verdictMatch[1].toLowerCase() as string)
      : undefined;

    const entry = {
      id: randomUUID(),
      slug: agent.slug,
      ens: agent.ens,
      text,
      ts: Date.now(),
      verdict,
    };

    lastPost.set(agent.slug, Date.now());
    pushEntry(biomeName, entry);

    if (verdictMatch) {
      verdicts.push({
        slug: agent.slug,
        verdict: verdictMatch[1].toLowerCase(),
      });
    }

    // Small delay so SSE entries arrive with visible pacing
    await new Promise((r) => setTimeout(r, 800));
  }

  // Tally message
  if (verdicts.length > 0) {
    const counts = verdicts.reduce(
      (acc, v) => {
        acc[v.verdict] = (acc[v.verdict] ?? 0) + 1;
        return acc;
      },
      {} as Record<string, number>,
    );
    const majority = Object.entries(counts).sort((a, b) => b[1] - a[1])[0];
    const summary = Object.entries(counts)
      .map(([k, v]) => `${v} ${k}`)
      .join(", ");
    const tallyText = `Tally: ${summary}. ${majority[1] >= Math.ceil(verdicts.length / 2) ? `Majority verdict: **${majority[0]}**.` : "No majority reached — quorum divided."}`;

    pushEntry(biomeName, {
      id: randomUUID(),
      slug: "tally",
      ens: "tally.hermes.eth",
      text: tallyText,
      ts: Date.now(),
    });
  }
}
