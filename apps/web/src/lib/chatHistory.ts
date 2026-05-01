import type { ChatMessage } from "./api";

export type ChatSession = {
  id: string;
  createdAt: number;
  title: string;
  messages: ChatMessage[];
};

const KEY = (addr: string, slug: string) =>
  `hermes:chatbot:${slug}:${addr.toLowerCase()}`;

export function loadSessions(addr: string, slug: string): ChatSession[] {
  try {
    const raw = localStorage.getItem(KEY(addr, slug));
    if (!raw) return [];
    return JSON.parse(raw) as ChatSession[];
  } catch {
    return [];
  }
}

export function saveSessions(
  addr: string,
  slug: string,
  sessions: ChatSession[],
): void {
  localStorage.setItem(KEY(addr, slug), JSON.stringify(sessions));
}

export function upsertSession(
  addr: string,
  slug: string,
  session: ChatSession,
): void {
  const all = loadSessions(addr, slug);
  const idx = all.findIndex((s) => s.id === session.id);
  if (idx >= 0) all[idx] = session;
  else all.unshift(session);
  saveSessions(addr, slug, all);
}

export function deleteSession(addr: string, slug: string, id: string): void {
  const all = loadSessions(addr, slug).filter((s) => s.id !== id);
  saveSessions(addr, slug, all);
}

export function deriveTitle(messages: ChatMessage[]): string {
  const first = messages.find((m) => m.role === "user");
  if (!first) return "New chat";
  return first.text.slice(0, 40) + (first.text.length > 40 ? "…" : "");
}
