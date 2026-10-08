import assert from "node:assert/strict";
import test from "node:test";
import { reconcileSocialMessages, summarizeReactions, type ReactionEvent, type ReconciledMessage } from "../src/components/social-message-state.ts";

const at = 1_800_000_000_000;
const message = (id: string, deliveryState: string, createdAt = at): ReconciledMessage => ({ id, deliveryState, createdAt });

test("an older poll cannot remove optimistic, failed, or freshly acknowledged sends", () => {
  const current = [message("pending", "pending"), message("failed", "failed"), message("sent", "sent")];
  assert.deepEqual(reconcileSocialMessages(current, [], at).map(item => item.id), ["failed", "pending", "sent"]);
});

test("server copies win without duplicates and genuinely old missing history can expire", () => {
  const current = [message("same", "sent"), message("old", "sent", at - 31_000)];
  const server = [message("same", "delivered", at + 1)];
  assert.deepEqual(reconcileSocialMessages(current, server, at), server);
});

test("a rapid hundred-message burst remains complete, unique, and ordered", () => {
  const optimistic = Array.from({ length: 100 }, (_, index) => message(`pending-${index}`, "pending", at + index));
  const stalePoll = Array.from({ length: 8 }, (_, index) => message(`existing-${index}`, "delivered", at - 100 + index));
  const merged = reconcileSocialMessages(optimistic, stalePoll, at + 100);
  assert.equal(merged.length, 108);
  assert.equal(new Set(merged.map(item => item.id)).size, 108);
  assert.deepEqual(merged.slice(-100).map(item => item.id), optimistic.map(item => item.id));
});

test("reactions count people independently and only remove the sender who toggled off", () => {
  const reaction = (id: string, senderId: string, reactionOperation: "add" | "remove", createdAt: number, deliveryState = "delivered"): ReactionEvent => ({ id, senderId, reactionOperation, createdAt, deliveryState, targetId: "message", emoji: "🔥" });
  const summaries = summarizeReactions([
    reaction("one", "parks", "add", 1),
    reaction("two", "friend", "add", 2),
    reaction("three", "parks", "remove", 3),
  ], "parks");
  assert.deepEqual(summaries.get("message"), [{ emoji: "🔥", count: 1, reactedByMe: false, pending: false }]);
});

test("pending reaction changes stay dim without corrupting the confirmed count", () => {
  const base: ReactionEvent = { id: "confirmed", senderId: "parks", targetId: "message", emoji: "👍", reactionOperation: "add", deliveryState: "delivered", createdAt: 1 };
  const removing: ReactionEvent = { ...base, id: "pending-remove", reactionOperation: "remove", deliveryState: "pending", createdAt: 2 };
  assert.deepEqual(summarizeReactions([base, removing], "parks").get("message"), [{ emoji: "👍", count: 1, reactedByMe: true, pending: true }]);
});
