import type { ChatMessage } from "./chat-types";
// Server sequence is committed under a conversation lock; timestamps alone
// cannot provide a reliable order during concurrent or retried sends.
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]) {
  const bySequence = new Map(
    current.map((message) => [message.sequence, message]),
  );
  for (const message of incoming) bySequence.set(message.sequence, message);
  return [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
}
