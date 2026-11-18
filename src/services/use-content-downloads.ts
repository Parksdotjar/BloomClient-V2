import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";

export type ContentDownload = {
  id: string; instanceId: string; instanceName: string; projectId: string;
  category: "mods" | "resourcepacks" | "shaderpacks";
  title: string; version: string; iconUrl?: string | null;
  state: "queued" | "installing" | "cancelling" | "installed" | "cancelled" | "error";
  message: string; progress: number; downloadedBytes: number; totalBytes: number; bytesPerSecond: number;
  completedAt?: number | null; revision: number;
};
type QueueSnapshot = { sessionId: string; revision: number; tasks: ContentDownload[] };
export type ContentRequest = Pick<ContentDownload, "instanceId" | "projectId" | "category" | "title" | "version" | "iconUrl">;
export const contentPending = (task: ContentDownload) => ["queued", "installing", "cancelling"].includes(task.state);
export const contentKind = (task: Pick<ContentDownload, "category">) => task.category === "mods" ? "mod" : task.category === "resourcepacks" ? "resourcepack" : "shaderpack";
const CHECKPOINT = "bloom-content-queue-observed-v1";
function readCheckpoint(): { sessionId: string; revision: number } {
  try { const value = JSON.parse(localStorage.getItem(CHECKPOINT) || "null"); if (value && typeof value.sessionId === "string" && Number.isFinite(value.revision)) return value; } catch { /* Fresh checkpoint. */ }
  return { sessionId: "", revision: -1 };
}

/** One native FIFO, recovered from revisioned snapshots after reload or missed events. */
export function useContentDownloads(options: {
  ultraPerformance: boolean;
  onInstalled: (tasks: ContentDownload[]) => void;
  onFailed: (task: ContentDownload) => void;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [tasks, setTasks] = useState<ContentDownload[]>([]);
  const tasksRef = useRef(tasks);
  const accepted = useRef({ sessionId: "", revision: -1 });
  const observed = useRef(readCheckpoint());
  const mounted = useRef(false);
  const accept = useCallback((snapshot: QueueSnapshot) => {
    if (!mounted.current || !snapshot || !Array.isArray(snapshot.tasks) || !snapshot.sessionId || !Number.isFinite(snapshot.revision)) return;
    if (accepted.current.sessionId === snapshot.sessionId && snapshot.revision <= accepted.current.revision) return;
    const since = observed.current.sessionId === snapshot.sessionId ? observed.current.revision : -1;
    const newlyInstalled = snapshot.tasks.filter(task => task.state === "installed" && task.revision > since);
    // The owner saves these records synchronously before acknowledging the snapshot.
    if (newlyInstalled.length) latest.current.onInstalled(newlyInstalled);
    snapshot.tasks.filter(task => task.state === "error" && task.revision > since).forEach(task => latest.current.onFailed(task));
    accepted.current = { sessionId: snapshot.sessionId, revision: snapshot.revision };
    observed.current = accepted.current;
    localStorage.setItem(CHECKPOINT, JSON.stringify(observed.current));
    tasksRef.current = snapshot.tasks;
    setTasks(snapshot.tasks);
  }, []);

  useEffect(() => {
    mounted.current = true;
    let disposed = false;
    let polling = false;
    let timer: number | undefined;
    let stop: (() => void) | undefined;
    const refresh = async () => {
      if (disposed || polling || document.hidden) return;
      polling = true;
      try { const snapshot = await invoke<QueueSnapshot>("get_content_downloads"); if (!disposed) accept(snapshot); }
      catch { /* Preserve known tasks while native state is temporarily unavailable. */ }
      finally { polling = false; }
    };
    const heartbeat = async () => {
      await refresh();
      if (!disposed) timer = window.setTimeout(heartbeat, tasksRef.current.some(contentPending) ? (latest.current.ultraPerformance ? 1200 : 600) : 3000);
    };
    void listen<QueueSnapshot>("content-downloads-changed", event => { if (!disposed) accept(event.payload); })
      .then(unlisten => { if (disposed) unlisten(); else stop = unlisten; })
      .catch(() => {}).finally(() => { if (!disposed) void heartbeat(); });
    const wake = () => { void refresh(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true; mounted.current = false;
      window.clearTimeout(timer); stop?.();
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, [accept]);

  const enqueue = useCallback(async (request: ContentRequest) => accept(await invoke<QueueSnapshot>("install_modrinth_content", request)), [accept]);
  const cancel = useCallback(async (taskId: string) => accept(await invoke<QueueSnapshot>("cancel_content_download", { taskId })), [accept]);
  const dismiss = useCallback(async (taskId: string) => accept(await invoke<QueueSnapshot>("dismiss_content_download", { taskId })), [accept]);
  const [, updateClock] = useState(0);
  const lastFinished = tasks.filter(task => !contentPending(task)).sort((a, b) => b.revision - a.revision)[0];
  const lastInstalled = lastFinished?.state === "installed" ? lastFinished : undefined;
  const completedUntil = (lastInstalled?.completedAt || 0) + 3000;
  useEffect(() => {
    const remaining = completedUntil - Date.now();
    if (remaining <= 0) return;
    const timer = window.setTimeout(() => updateClock(value => value + 1), remaining + 1);
    return () => window.clearTimeout(timer);
  }, [completedUntil]);
  const current = tasks.find(task => task.state === "installing" || task.state === "cancelling") || tasks.find(task => task.state === "queued");
  return { tasks, enqueue, cancel, dismiss, current: current || (Date.now() < completedUntil ? lastInstalled : undefined) };
}
