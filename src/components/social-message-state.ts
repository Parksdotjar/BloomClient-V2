export type ReconciledMessage = {
  id: string;
  createdAt: number;
  deliveryState: string;
};

export type ReactionEvent = {
  id: string;
  senderId: string;
  targetId: string | null;
  emoji: string | null;
  reactionOperation: "add" | "remove" | "reply" | null;
  deliveryState: string;
  createdAt: number;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  reactedByMe: boolean;
  pending: boolean;
};

export function summarizeReactions(events: ReactionEvent[], meId: string): Map<string, ReactionSummary[]> {
  const targets = new Map<string, Map<string, Map<string, { active: boolean; pending: boolean }>>>();
  const ordered = [...events].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
  for (const event of ordered) {
    if (!event.targetId || !event.emoji || !["add", "remove"].includes(event.reactionOperation || "")) continue;
    const emojis = targets.get(event.targetId) || new Map();
    const people = emojis.get(event.emoji) || new Map();
    const previous = people.get(event.senderId) || { active: false, pending: false };
    if (event.deliveryState === "pending") {
      people.set(event.senderId, {
        active: event.reactionOperation === "add" ? true : previous.active,
        pending: true,
      });
    } else if (event.reactionOperation === "add") {
      people.set(event.senderId, { active: true, pending: false });
    } else {
      people.delete(event.senderId);
    }
    emojis.set(event.emoji, people);
    targets.set(event.targetId, emojis);
  }
  const result = new Map<string, ReactionSummary[]>();
  for (const [targetId, emojis] of targets) {
    const summaries = [...emojis].map(([emoji, people]) => ({
      emoji,
      count: [...people.values()].filter(person => person.active).length,
      reactedByMe: people.get(meId)?.active === true,
      pending: [...people.values()].some(person => person.pending),
    })).filter(summary => summary.count > 0);
    if (summaries.length) result.set(targetId, summaries);
  }
  return result;
}

const RECENT_SENT_GRACE_MS = 30_000;

// Snapshot polling is eventually consistent with an optimistic send. Keep local
// work that cannot safely be discarded, while letting old delivered history
// expire normally when the encrypted vault no longer returns it.
export function reconcileSocialMessages<T extends ReconciledMessage>(
  current: T[],
  incoming: T[],
  now = Date.now(),
): T[] {
  const merged = new Map(incoming.map(message => [message.id, message]));
  for (const message of current) {
    const localOnly = message.deliveryState === "pending" || message.deliveryState === "failed";
    const recentlySent = message.deliveryState === "sent" && message.createdAt > now - RECENT_SENT_GRACE_MS;
    if (!merged.has(message.id) && (localOnly || recentlySent)) merged.set(message.id, message);
  }
  return [...merged.values()].sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id));
}
