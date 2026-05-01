import { Router, type Router as ExpressRouter } from "express";
import { randomUUID } from "node:crypto";
import { callLLM } from "../llm.js";
import { getChatbotAgent } from "../registry.js";

export const chatbotRouter: ExpressRouter = Router();

type ChatMessage = {
  id: string;
  role: "user" | "agent";
  text: string;
  ts: number;
  // On-chain evidence fields (populated when using real chain)
  rootHash?: string;
  txHash?: string;
  isEncrypted?: boolean;
};

// In-memory chat log per session (keyed by slug + sessionId)
const sessions = new Map<string, ChatMessage[]>();

function getLog(slug: string, sessionId: string): ChatMessage[] {
  const key = `${slug}:${sessionId}`;
  if (!sessions.has(key)) sessions.set(key, []);
  return sessions.get(key)!;
}

chatbotRouter.get("/:slug/log", (req, res) => {
  const { slug } = req.params;
  const sessionId = (req.query.session as string) ?? "default";
  res.json(getLog(slug, sessionId));
});

chatbotRouter.post("/:slug/message", async (req, res) => {
  const { slug } = req.params;
  const agent = getChatbotAgent();

  if (!agent || agent.slug !== slug) {
    res.status(404).json({ error: "chatbot agent not found" });
    return;
  }

  const { text, sessionId = "default" } = req.body as {
    text?: string;
    sessionId?: string;
  };

  if (typeof text !== "string" || !text.trim()) {
    res.status(400).json({ error: "text must be a non-empty string" });
    return;
  }

  const log = getLog(slug, sessionId);

  const userMsg: ChatMessage = {
    id: randomUUID(),
    role: "user",
    text: text.trim(),
    ts: Date.now(),
    isEncrypted: true,
    // rootHash would come from a real 0G upload
    rootHash: `0x${randomUUID().replace(/-/g, "")}`,
  };
  log.push(userMsg);

  // Build history for LLM
  const history = log.slice(-12).map((m) => ({
    role: (m.role === "agent" ? "assistant" : "user") as "user" | "assistant",
    content: m.text,
  }));
  // Remove the last user message from history (it's passed as userPrompt)
  if (history.length > 0 && history[history.length - 1].role === "user") {
    history.pop();
  }

  let replyText: string;
  try {
    replyText = await callLLM({
      persona: agent.persona,
      history,
      userPrompt: text.trim(),
      maxTokens: 300,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
    return;
  }

  const agentMsg: ChatMessage = {
    id: randomUUID(),
    role: "agent",
    text: replyText,
    ts: Date.now(),
    isEncrypted: true,
    rootHash: `0x${randomUUID().replace(/-/g, "")}`,
  };
  log.push(agentMsg);

  res.json({ userMessage: userMsg, agentMessage: agentMsg });
});
