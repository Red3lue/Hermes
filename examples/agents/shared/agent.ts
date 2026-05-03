import { Hermes, type ReceivedMessage } from "hermes-agents-sdk";
import { chat, type Turn } from "./llm";

export type AgentRole = {
  name: string; // human-readable for logs
  systemPrompt: string;
  maxTurns: number;
};

export class HermesAgent {
  private history: Turn[] = [];
  private turnCount = 0;
  private lastSeenBlock = 0n;
  private active = true;
  private seenRoots = new Set<string>();

  constructor(
    private hermes: Hermes,
    private role: AgentRole,
    private getBlock: () => Promise<bigint>,
  ) {}

  async start(opening?: { to: string; text: string }) {
    await this.hermes.register();
    this.lastSeenBlock = await this.getBlock();
    this.log(`registered. polling from block ${this.lastSeenBlock}`);

    if (opening) {
      this.log(`→ ${opening.to}: ${opening.text}`);
      const sent = await this.hermes.send(opening.to, opening.text);
      this.seenRoots.add(sent.rootHash);
      this.history.push({ role: "assistant", content: opening.text });
    }

    let backoff = 3000;
    while (this.active) {
      try {
        await this.poll();
        backoff = 3000;
      } catch (err) {
        this.log(`poll error: ${(err as Error).message.split("\n")[0]}`);
        backoff = Math.min(backoff * 2, 30000); // exponential, cap 30s
      }
      await sleep(backoff);
    }
    this.log("done.");
  }

  stop() {
    this.active = false;
  }

  private async poll() {
    const messages = await this.hermes.fetchInbox(this.lastSeenBlock);
    const fresh = messages.filter(
      (m: ReceivedMessage) =>
        !this.seenRoots.has(m.rootHash) && m.from !== this.role.name,
    );

    for (const msg of fresh) {
      this.seenRoots.add(msg.rootHash);
      this.lastSeenBlock = msg.blockNumber + 1n;
      await this.handle(msg);
      if (!this.active) return;
    }

    if (messages.length > 0) {
      const tip = messages[messages.length - 1].blockNumber + 1n;
      if (tip > this.lastSeenBlock) this.lastSeenBlock = tip;
    }
  }

  private async handle(msg: ReceivedMessage) {
    this.log(`← ${msg.from}: ${msg.text}`);
    this.history.push({ role: "user", content: msg.text });

    if (this.turnCount >= this.role.maxTurns) {
      this.log("max turns reached, refusing further reply");
      this.stop();
      return;
    }

    const reply = await chat(this.role.systemPrompt, this.history);
    this.history.push({ role: "assistant", content: reply });
    this.turnCount += 1;

    this.log(`→ ${msg.from}: ${reply}`);
    const sent = await this.hermes.send(msg.from, reply, msg.rootHash);
    this.seenRoots.add(sent.rootHash);

    if (containsDeal(reply)) {
      this.log("deal detected, stopping.");
      this.stop();
    }
  }

  private log(line: string) {
    console.log(`[${this.role.name}] ${line}`);
  }
}

function containsDeal(text: string): boolean {
  return /\[DEAL\]|\[ACCEPT\]/i.test(text);
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
