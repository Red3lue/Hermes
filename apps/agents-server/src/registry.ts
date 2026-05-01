import { readFileSync, readdirSync, statSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
// agents folder lives at apps/web/agents/ relative to repo root
const AGENTS_DIR = resolve(__dirname, "../../web/agents");

export type AgentDef = {
  slug: string;
  ens: string;
  address: string;
  roles: string[];
  x25519PubKey: string;
  persona: string; // raw markdown content
};

let _agents: AgentDef[] | null = null;

export function loadAgents(): AgentDef[] {
  if (_agents) return _agents;

  const entries = readdirSync(AGENTS_DIR).filter((name) => {
    if (name.startsWith("_")) return false; // skip _quorum etc.
    try {
      return statSync(join(AGENTS_DIR, name)).isDirectory();
    } catch {
      return false;
    }
  });

  _agents = entries.map((slug) => {
    const dir = join(AGENTS_DIR, slug);
    const agentJson = JSON.parse(readFileSync(join(dir, "agent.json"), "utf8"));
    const persona = readFileSync(join(dir, "persona.md"), "utf8");
    return {
      slug,
      ens: agentJson.ens as string,
      address: (agentJson.address as string) ?? "",
      roles: (agentJson.roles as string[]) ?? [],
      x25519PubKey: (agentJson.x25519PubKey as string) ?? "",
      persona,
    };
  });

  console.log(
    `[registry] loaded ${_agents.length} agents: ${_agents.map((a) => a.slug).join(", ")}`,
  );
  return _agents;
}

export function getAgent(slug: string): AgentDef | undefined {
  return loadAgents().find((a) => a.slug === slug);
}

export function getQuorumAgents(): AgentDef[] {
  return loadAgents().filter((a) => a.roles.includes("quorum"));
}

export function getChatbotAgent(): AgentDef | undefined {
  return loadAgents().find((a) => a.roles.includes("chatbot"));
}

export function getDefaultContext(): string {
  try {
    return readFileSync(
      resolve(AGENTS_DIR, "_quorum/default-context.md"),
      "utf8",
    );
  } catch {
    return "# Default Context\n\nShould the protocol upgrade to BLS aggregated signatures in v0.3?";
  }
}
