// Quorum-specific envelope payloads. These live INSIDE the encrypted body
// of a generic Hermes envelope. The SDK has no awareness of these types.
// The FE mirrors this file.

export type QuorumStage =
  | "started"
  | "member-replied"
  | "tally"
  | "report-posted";

export type QuorumBody =
  | {
      kind: "request";
      requestId: string; // user-generated uuid; reused as contextId internally
      markdown: string;
      targetBiome?: string; // reserved for multi-biome routing; demo always omits
    }
  | {
      kind: "final-response";
      requestId: string;
      markdown: string;
      tally: Record<string, number>;
    }
  | {
      kind: "context";
      biomeName: string;
      markdown: string;
      contextId: string; // client-generated unique id (uuid)
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
