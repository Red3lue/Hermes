import Anthropic from "@anthropic-ai/sdk";

export type Turn = { role: "user" | "assistant"; content: string };

const MODEL = "claude-haiku-4-5-20251001";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY missing in environment");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export async function chat(system: string, history: Turn[]): Promise<string> {
  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: 256,
    system,
    messages: history,
  });
  const block = resp.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`unexpected content block: ${block?.type}`);
  }
  return block.text.trim();
}
