import { useEffect, useState } from "react";
import { invoke } from "./invoke";

export type ClientNotice = {
  id: string;
  message: string;
  createdAt: number;
  expiresAt: number;
};

type NoticeFeed = { notice: ClientNotice | null; serverTime: number };
type TimedNotice = { notice: ClientNotice; monotonicDeadline: number; wallDeadline: number };

const POLL_INTERVAL_MS = 12_000;
const MAX_DURATION_MS = 24 * 60 * 60 * 1000;

function validNotice(notice: ClientNotice | null | undefined): notice is ClientNotice {
  return Boolean(notice &&
    typeof notice.id === "string" && notice.id.length > 0 && notice.id.length <= 128 &&
    typeof notice.message === "string" && notice.message.trim().length > 0 &&
    notice.message.length <= 600 &&
    Number.isSafeInteger(notice.createdAt) && Number.isSafeInteger(notice.expiresAt) &&
    notice.expiresAt > notice.createdAt && notice.expiresAt - notice.createdAt <= MAX_DURATION_MS);
}

export function useClientNotice(): ClientNotice | null {
  const [notice, setNotice] = useState<ClientNotice | null>(null);

  useEffect(() => {
    let disposed = false;
    let polling = false;
    let active: TimedNotice | null = null;
    let expiry: number | undefined;

    function updateExpiry() {
      window.clearTimeout(expiry);
      const remaining = active
        ? Math.min(active.monotonicDeadline - performance.now(), active.wallDeadline - Date.now())
        : 0;
      setNotice(remaining > 0 && active ? active.notice : null);
      if (remaining > 0) expiry = window.setTimeout(updateExpiry, Math.ceil(remaining));
    }

    async function refresh() {
      if (disposed) return;
      updateExpiry();
      if (polling) return;
      polling = true;
      const started = performance.now();
      try {
        const feed = await invoke<NoticeFeed>("get_client_notice");
        if (disposed || !feed || !Number.isSafeInteger(feed.serverTime)) return;
        if (feed.notice === null) {
          active = null;
        } else if (validNotice(feed.notice)) {
          const received = performance.now();
          // Use the server-relative lifetime so a skewed local clock cannot extend the notice.
          const remaining = feed.notice.expiresAt - feed.serverTime - (received - started) / 2;
          if (remaining > MAX_DURATION_MS) return;
          const monotonicDeadline = received + remaining;
          const wallDeadline = Date.now() + remaining;
          if (active?.notice.id === feed.notice.id) {
            // Preserve the earlier monotonic deadline across polls and rebase the sleep fallback.
            active.monotonicDeadline = Math.min(active.monotonicDeadline, monotonicDeadline);
            active.wallDeadline = wallDeadline;
          } else {
            active = { notice: feed.notice, monotonicDeadline, wallDeadline };
          }
        }
        updateExpiry();
      } catch {
        // A failed refresh leaves the previous notice visible until its known deadline.
      } finally {
        polling = false;
      }
    }

    const wake = () => { void refresh(); };
    const becameVisible = () => { if (!document.hidden) wake(); };
    wake();
    const poll = window.setInterval(wake, POLL_INTERVAL_MS);
    window.addEventListener("focus", wake);
    window.addEventListener("online", wake);
    document.addEventListener("visibilitychange", becameVisible);
    return () => {
      disposed = true;
      window.clearInterval(poll);
      window.clearTimeout(expiry);
      window.removeEventListener("focus", wake);
      window.removeEventListener("online", wake);
      document.removeEventListener("visibilitychange", becameVisible);
    };
  }, []);

  return notice;
}
