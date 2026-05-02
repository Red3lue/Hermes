import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-sonnet-4-6";

let _client: Anthropic | null = null;

function client(): Anthropic {
  if (!_client) {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error("ANTHROPIC_API_KEY not set");
    }
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

export type Turn = { role: "user" | "assistant"; content: string };

export async function callLLM(opts: {
  persona: string;
  extraSystemContent?: string;
  history: Turn[];
  userPrompt: string;
  maxTokens?: number;
}): Promise<string> {
  const systemBlocks = [
    {
      type: "text" as const,
      text: opts.persona,
      // cache the persona so repeated calls in a quorum round don't burn tokens
      cache_control: { type: "ephemeral" as const },
    },
  ];
  if (opts.extraSystemContent) {
    systemBlocks.push({ type: "text" as const, text: opts.extraSystemContent, cache_control: null as unknown as { type: "ephemeral" } });
  }

  const messages: Anthropic.Messages.MessageParam[] = [
    ...opts.history.map((t) => ({
      role: t.role as "user" | "assistant",
      content: t.content,
    })),
    { role: "user" as const, content: opts.userPrompt },
  ];

  const resp = await client().messages.create({
    model: MODEL,
    max_tokens: opts.maxTokens ?? 200,
    system: systemBlocks,
    messages,
  });

  const block = resp.content[0];
  if (!block || block.type !== "text") {
    throw new Error(`unexpected LLM content block: ${block?.type}`);
  }
  return block.text.trim();
}
