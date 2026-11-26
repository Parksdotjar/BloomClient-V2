import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type { FollowUpdate } from "./follow-updates";
import { invoke } from "./invoke";

export type NotificationItem = {
  id: string;
  kind: "modUpdateCompleted" | "modUpdateFailed" | "launcherUpdate" | "followedRelease";
  modId?: string;
  instanceId?: string | null;
  instanceName?: string | null;
  version?: string | null;
  required: boolean;
  createdAt: number;
  read: boolean;
  available: boolean;
};

export function useNotificationCenter() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [settled, setSettled] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const reading = useRef(0);
  const followedObservations = useRef(new Map<string, string>());

  const refresh = useCallback(async () => {
    const request = ++reading.current;
    try {
      const snapshot = await invoke<NotificationItem[]>("get_notifications");
      if (request !== reading.current) return;
      if (!Array.isArray(snapshot)) {
        setLoadError(true);
        return;
      }
      setItems(snapshot);
      setLoadError(false);
    } catch {
      if (request === reading.current) setLoadError(true);
    } finally {
      if (request === reading.current) setSettled(true);
    }
  }, []);

  useEffect(() => {
    let stopped = false;
    let unlisten: (() => void) | undefined;
    // Events invalidate the view. Reading the latest native snapshot avoids applying
    // an older event payload after another window has marked an entry as read.
    void listen("notifications-changed", () => { if (!stopped) void refresh(); })
      .then(stop => { if (stopped) stop(); else unlisten = stop; })
      .catch(() => {})
      .finally(() => { if (!stopped) void refresh(); });
    const wake = () => { if (!document.hidden) void refresh(); };
    window.addEventListener("focus", wake);
    return () => {
      stopped = true;
      reading.current++;
      unlisten?.();
      window.removeEventListener("focus", wake);
    };
  }, [refresh]);

  const observeLauncher = useCallback(async (currentVersion: string, availableVersion?: string, authoritative = false) => {
    try {
      await invoke("observe_launcher_notification", { currentVersion, availableVersion: availableVersion ?? null, authoritative });
      void refresh();
    } catch { /* Update discovery remains usable if local history cannot be written. */ }
  }, [refresh]);

  const observeFollowed = useCallback((instanceId: string, review: FollowUpdate | null) => {
    if (!review) {
      followedObservations.current.delete(instanceId);
      return;
    }
    const { installedRevision, latestRevision, required } = review;
    const observation = JSON.stringify([installedRevision, latestRevision, required]);
    if (followedObservations.current.get(instanceId) === observation) return;
    followedObservations.current.set(instanceId, observation);
    void invoke("observe_followed_notification", { instanceId, installedRevision, latestRevision, required })
      .then(refresh).catch(() => {
        if (followedObservations.current.get(instanceId) === observation) followedObservations.current.delete(instanceId);
      });
  }, [refresh]);

  const markRead = useCallback(async (id?: string) => {
    try {
      await invoke("mark_notifications_read", { id: id ?? null });
      await refresh();
    } catch {
      setLoadError(true);
    }
  }, [refresh]);

  return { items, settled, loadError, refresh, observeLauncher, observeFollowed, markRead };
}
