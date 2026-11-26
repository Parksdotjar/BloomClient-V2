import { useCallback, useEffect, useRef, useState } from "react";
import type { NativeLaunchProgress } from "./use-launcher-activity";

export type TitleBarLaunchProgress = { id: string; percent: number; phase: "launching" | "launched" };

// Let the title bar compact to its confirmation, hold it briefly, then restore the bell.
const LAUNCHED_DISPLAY_MS = 1450;

export function useTitleBarLaunchProgress() {
  const [progress, setProgress] = useState<TitleBarLaunchProgress>();
  const current = useRef<TitleBarLaunchProgress | undefined>(undefined);
  const clearTimer = useRef<number | undefined>(undefined);
  const finished = useRef<string | undefined>(undefined);
  const accept = useCallback(({ launchId, state, progress: reported }: NativeLaunchProgress) => {
    if (!launchId || launchId === finished.current) return;
    const active = current.current;
    if (state === "installing" || state === "launching") {
      if (active?.id === launchId && active.phase === "launched") return;
      const percent = Math.max(active?.id === launchId ? active.percent : 0,
        Number.isFinite(reported) ? Math.min(99, Math.round(reported)) : 0);
      if (active?.id === launchId && active.percent === percent) return;
      window.clearTimeout(clearTimer.current);
      current.current = { id: launchId, percent, phase: "launching" };
      setProgress(current.current);
      return;
    }
    if (active?.id !== launchId) return;
    if (state === "running") {
      if (active.phase === "launched") return;
      current.current = { id: launchId, percent: 100, phase: "launched" };
      setProgress(current.current);
      clearTimer.current = window.setTimeout(() => {
        finished.current = launchId;
        current.current = undefined;
        setProgress(undefined);
      }, LAUNCHED_DISPLAY_MS);
      return;
    }
    if (state === "error" || state === "cancelled" || (state === "idle" && active.phase === "launching")) {
      window.clearTimeout(clearTimer.current);
      finished.current = launchId;
      current.current = undefined;
      setProgress(undefined);
    }
  }, []);
  useEffect(() => () => window.clearTimeout(clearTimer.current), []);
  return { progress, accept };
}
