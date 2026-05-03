// Selector demo envelope payloads. Lives INSIDE the encrypted body of a
// generic Hermes envelope. Mirrored verbatim by apps/web/src/lib/selectorEnvelopes.ts.

export type SelectorBody =
  | {
      kind: "request";
      requestId: string; // user-generated uuid
      markdown: string;
    }
  | {
      kind: "expert-request";
      requestId: string;
      markdown: string;
      requesterEns: string; // the user the selector is acting on behalf of
      reason: string; // why the selector picked this expert
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
      markdown: string; // selector's framing + expert's reply
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
