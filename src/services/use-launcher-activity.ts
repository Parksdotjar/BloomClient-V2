import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";

export type NativeLaunchProgress = {
  state: string; progress: number; message: string; instanceId?: string;
  downloadedBytes?: number; totalBytes?: number; bytesPerSecond?: number;
};

type ActivityOptions = {
  activity: { active: boolean; state: string; instanceId?: string };
  running: boolean;
  ultraPerformance: boolean;
  requestPending: () => boolean;
  onProgress: (progress: NativeLaunchProgress) => void;
  onRunning: (running: boolean) => void;
};

/** Events give immediate feedback; snapshots recover events missed while suspended. */
export function useLauncherActivity(options: ActivityOptions) {
  const latest = useRef(options);
  latest.current = options;
  useEffect(() => {
    let disposed = false;
    let polling = false;
    let revision = 0;
    let timer: number | undefined;
    let lastProgress = "";
    const unlisten: Array<() => void> = [];
    const acceptProgress = (progress: NativeLaunchProgress) => {
      if (!progress || !["idle", "installing", "launching", "running", "complete", "error", "cancelled"].includes(progress.state)) return;
      const key = JSON.stringify(progress);
      // Do not replay notifications or revive a completed download on every poll.
      if (key === lastProgress && latest.current.activity.state === progress.state) return;
      lastProgress = key;
      latest.current.onProgress(progress);
    };
    const refresh = async () => {
      if (disposed || polling || document.hidden) return;
      polling = true;
      const before = revision;
      const activity = latest.current.activity;
      try {
        const [progress, running] = await Promise.allSettled([
          invoke<NativeLaunchProgress>("get_minecraft_launch_status"),
          invoke<boolean>("get_minecraft_process_running"),
        ]);
        // A native event or a newly requested operation wins over an older snapshot.
        if (disposed || revision !== before || latest.current.activity !== activity || latest.current.requestPending()) return;
        if (running.status === "fulfilled" && typeof running.value === "boolean") latest.current.onRunning(running.value);
        if (progress.status === "fulfilled" && progress.value) {
          const next = progress.value;
          if (!activity.active || activity.instanceId === next.instanceId) acceptProgress(next);
        }
      } finally {
        polling = false;
      }
    };
    const heartbeat = async () => {
      await refresh();
      if (disposed) return;
      const current = latest.current;
      timer = window.setTimeout(heartbeat, current.activity.active || current.running ? (current.ultraPerformance ? 1200 : 600) : 3000);
    };
    const register = async <T,>(event: string, apply: (payload: T) => void) => {
      try {
        const stop = await listen<T>(event, ({ payload }) => {
          if (disposed) return;
          revision++;
          apply(payload);
        });
        if (disposed) stop();
        else unlisten.push(stop);
      } catch {
        // Polling remains authoritative when an event subscription is unavailable.
      }
    };
    void Promise.all([
      register<NativeLaunchProgress>("minecraft-launch-progress", acceptProgress),
      register<boolean>("minecraft-process-state", running => latest.current.onRunning(running)),
    ]).then(() => { if (!disposed) void heartbeat(); });
    const wake = () => { void refresh(); };
    window.addEventListener("focus", wake);
    document.addEventListener("visibilitychange", wake);
    return () => {
      disposed = true;
      window.clearTimeout(timer);
      unlisten.forEach(stop => stop());
      window.removeEventListener("focus", wake);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);
}
