import { loadAgents, getChatbotAgent } from "../registry.js";
import { spawnAgentRuntime } from "../runtime/agentRuntime.js";
import { makeConciergeHandler } from "./concierge.js";

/** Boot the 1:1 chatbot runtime. The concierge agent (role "chatbot")
 * polls its inbox for sealed DMs from any user, decrypts, calls the LLM
 * with persona + per-sender history, and replies via sealed DM back. */
export async function bootChatbot(): Promise<() => void> {
  loadAgents();
  const concierge = getChatbotAgent();
  if (!concierge) {
    console.warn("[chatbot] no chatbot agent found — chatbot disabled");
    return () => {};
  }
  console.log(`[chatbot] booting concierge=${concierge.slug}`);
  return spawnAgentRuntime(concierge, makeConciergeHandler(concierge));
}
