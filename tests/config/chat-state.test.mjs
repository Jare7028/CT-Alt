import test from "node:test";
import assert from "node:assert/strict";
import { mergeMessages } from "../../lib/chat-state.ts";
const message = (sequence) => ({
  sequence,
  conversation_id: "synthetic",
  sender_id: "sender",
  sender_name: "Synthetic",
  client_id: `id-${sequence}`,
  body: `Message ${sequence}`,
  created_at: "2026-10-03T00:00:00Z",
});
test("reconnect overlap and retried send reconcile one message per server sequence", () => {
  const previous = [message(2), message(1)];
  const result = mergeMessages(previous, [message(3), message(2)]);
  assert.deepEqual(
    result.map((item) => item.sequence),
    [1, 2, 3],
  );
  assert.equal(previous.length, 2);
  assert.deepEqual(mergeMessages(result, [message(3)]), result);
});
test("equal timestamps use server sequence for stable ordering and paginated history", () => {
  assert.deepEqual(
    mergeMessages(
      [message(100), message(101)],
      [message(99), message(100)],
    ).map((item) => item.sequence),
    [99, 100, 101],
  );
});
