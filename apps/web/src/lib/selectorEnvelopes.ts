// Mirror of apps/agents-server/src/selector/envelopes.ts. Kept in sync by
// hand — the SDK is intentionally unaware of selector semantics.

export type SelectorBody =
  | {
      kind: "request";
      requestId: string;
      markdown: string;
    }
  | {
      kind: "expert-request";
      requestId: string;
      markdown: string;
      requesterEns: string;
      reason: string;
    }
  | {
      kind: "expert-reply";
      requestId: string;
      markdown: string;
      expertEns: string;
    }
  | {
      kind: "final-response";
      requestId: string;
      markdown: string;
      expertEns: string;
      reason: string;
    };

export function encodeBody(body: SelectorBody): string {
  return JSON.stringify(body);
}

export function decodeBody(text: string): SelectorBody | null {
  try {
    const obj = JSON.parse(text) as SelectorBody;
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

export function newRequestId(): string {
  return crypto.randomUUID();
}
