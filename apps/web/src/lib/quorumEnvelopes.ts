// Mirror of apps/agents-server/src/quorum/envelopes.ts. Kept in sync by
// hand — the union has 6 variants and the SDK is intentionally unaware of
// quorum semantics.

export type QuorumStage =
  | "started"
  | "member-replied"
  | "tally"
  | "report-posted";

export type QuorumBody =
  | {
      kind: "context";
      biomeName: string;
      markdown: string;
      contextId: string;
    }
  | {
      kind: "stage";
      stage: QuorumStage;
      contextId: string;
      meta: Record<string, unknown>;
    }
  | {
      kind: "deliberate";
      contextId: string;
      contextMarkdown: string;
    }
  | {
      kind: "verdict";
      contextId: string;
      slug: string;
      text: string;
      verdict: "agree" | "disagree" | "abstain";
    }
  | {
      kind: "bundle";
      contextId: string;
      contextMarkdown: string;
      verdicts: Array<{
        slug: string;
        ens: string;
        text: string;
        verdict: "agree" | "disagree" | "abstain";
      }>;
    }
  | {
      kind: "report";
      contextId: string;
      markdown: string;
      tally: Record<string, number>;
    };

export function encodeBody(body: QuorumBody): string {
  return JSON.stringify(body);
}

export function decodeBody(text: string): QuorumBody | null {
  try {
    const obj = JSON.parse(text) as QuorumBody;
    if (
      typeof obj !== "object" ||
      obj === null ||
      typeof (obj as { kind?: string }).kind !== "string"
    ) {
      return null;
    }
    return obj;
  } catch {
    return null;
  }
}

export function newContextId(): string {
  return crypto.randomUUID();
}
