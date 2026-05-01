import { useState, useEffect, useCallback } from "react";
import { readInbox, type InboxMessage, type InboxConfig } from "@hermes/sdk";
import { publicClient, INBOX_CONTRACT } from "@/lib/chainConfig";

const inboxConfig: InboxConfig = {
  contract: INBOX_CONTRACT,
  publicClient,
};

export function useAgentInbox(ensName: string | undefined) {
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchInbox = useCallback(async () => {
    if (!ensName) return;
    setLoading(true);
    setError(null);
    try {
      const msgs = await readInbox(inboxConfig, ensName, 0n);
      setMessages(msgs);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [ensName]);

  useEffect(() => {
    fetchInbox();
  }, [fetchInbox]);

  // Poll every 8 seconds
  useEffect(() => {
    if (!ensName) return;
    const id = setInterval(fetchInbox, 8000);
    return () => clearInterval(id);
  }, [fetchInbox, ensName]);

  return { messages, loading, error, refetch: fetchInbox };
}
