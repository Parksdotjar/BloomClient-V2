import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "./invoke";

export const supportsNowPlaying = /^Win/i.test(navigator.platform);

export type NowPlayingAction = "play" | "pause" | "previous" | "next";

type VolumeTarget = { scope: "app" | "system"; targetId?: string };
export type NowPlayingVolume = VolumeTarget & { level: number; muted: boolean };

export type DesktopNowPlaying = {
  sessionId: string;
  title: string;
  artist: string;
  source: string;
  isPlaying: boolean;
  canPlay: boolean;
  canPause: boolean;
  canPrevious: boolean;
  canNext: boolean;
  appIcon?: string;
};

type NowPlayingEvent = {
  observationId: string;
  session: DesktopNowPlaying | null;
};

const capability = {
  play: "canPlay",
  pause: "canPause",
  previous: "canPrevious",
  next: "canNext",
} as const;

const VOLUME_REFRESH_MS = 800;
let bridge = Promise.resolve();

function queueBridge(operation: () => Promise<void>) {
  bridge = bridge.then(operation).catch(() => {});
  return bridge;
}

type VolumeConnection = {
  observationId: string;
  sessionId: string;
  revision: number;
  reading: boolean;
  writing: boolean;
  pending?: NowPlayingVolume;
};

function readVolume(value: NowPlayingVolume | null) {
  return value && Number.isFinite(value.level) && value.level >= 0 && value.level <= 1 &&
    typeof value.muted === "boolean" &&
    (value.scope === "app" || (value.scope === "system" && typeof value.targetId === "string" && value.targetId.length > 0))
    ? value : null;
}

function sameVolumeTarget(left: VolumeTarget, right: VolumeTarget) {
  return left.scope === right.scope && left.targetId === right.targetId;
}

function useAppVolume(observationId: string | undefined, sessionId: string | undefined) {
  const active = useRef<VolumeConnection | null>(null);
  const [volume, setVolume] = useState<NowPlayingVolume | null>();

  useLayoutEffect(() => {
    setVolume(undefined);
    if (!observationId || !sessionId) return;
    const connection: VolumeConnection = { observationId, sessionId, revision: 0, reading: false, writing: false };
    active.current = connection;

    async function refresh() {
      if (connection.reading || connection.writing) return;
      const revision = connection.revision;
      connection.reading = true;
      const value = await invoke<NowPlayingVolume | null>("get_now_playing_volume", { observationId, sessionId })
        .then(readVolume).catch(() => null);
      connection.reading = false;
      if (active.current === connection && revision === connection.revision && !connection.writing) setVolume(value);
    }

    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, VOLUME_REFRESH_MS);
    return () => {
      active.current = null;
      window.clearInterval(timer);
    };
  }, [observationId, sessionId]);

  function changeVolume(sessionId: string, level: number) {
    const connection = active.current;
    if (!connection || sessionId !== connection.sessionId || !volume || !Number.isFinite(level) || level < 0 || level > 1) return;
    connection.revision++;
    const next = { ...volume, level };
    connection.pending = next;
    setVolume(next);
    if (connection.writing) return;

    // Deliver live changes in order and retain only the newest value during an in-flight write.
    connection.writing = true;
    void (async () => {
      while (active.current === connection && connection.pending !== undefined) {
        const target = connection.pending;
        connection.pending = undefined;
        const value = await invoke<NowPlayingVolume | null>("set_now_playing_volume", {
          observationId: connection.observationId, sessionId,
          level: target.level, scope: target.scope, targetId: target.targetId,
        }).then(readVolume).catch(() => null);
        if (active.current !== connection) break;
        // If the mixer or device changed during this drag, retire its queued writes.
        if (!value || !sameVolumeTarget(value, target)) connection.pending = undefined;
        if (connection.pending === undefined) setVolume(value);
      }
      connection.writing = false;
    })();
  }

  return { volume, changeVolume };
}

export function useNowPlaying(eligible: boolean) {
  const enabled = eligible && supportsNowPlaying;
  const [session, setSession] = useState<DesktopNowPlaying | null>(null);
  const [details, setDetails] = useState<string | null>(null);
  const [pausedFromIsland, setPausedFromIsland] = useState<string | null>(null);
  const observation = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!enabled) {
      setSession(null);
      setPausedFromIsland(null);
      setDetails(null);
      return;
    }
    const observationId = crypto.randomUUID();
    observation.current = observationId;
    let closed = false;
    let unlisten: (() => void) | undefined;
    const stop = () => invoke("stop_now_playing", { observationId }).catch(() => {});
    void (async () => {
      const unsubscribe = await listen<NowPlayingEvent>("desktop-now-playing", ({ payload }) => {
        if (!closed && payload.observationId === observationId) setSession(payload.session);
      });
      if (closed) { unsubscribe(); return; }
      unlisten = unsubscribe;
      await queueBridge(async () => {
        if (closed) return;
        try {
          await invoke("start_now_playing", { observationId });
        } catch {
          if (!closed) setSession(null);
        }
      });
    })().catch(() => { if (!closed) setSession(null); });

    return () => {
      closed = true;
      observation.current = undefined;
      unlisten?.();
      void queueBridge(async () => { await stop(); });
    };
  }, [enabled]);

  useEffect(() => {
    if (pausedFromIsland && session?.sessionId !== pausedFromIsland) setPausedFromIsland(null);
  }, [session?.sessionId, pausedFromIsland]);

  const displayed = enabled && session &&
    (session.isPlaying || session.sessionId === pausedFromIsland || session.sessionId === details) ? session : undefined;
  const volume = useAppVolume(enabled ? observation.current : undefined, displayed?.sessionId === details ? details : undefined);

  async function control(sessionId: string, action: NowPlayingAction) {
    const observationId = observation.current;
    if (!observationId || displayed?.sessionId !== sessionId || !displayed[capability[action]]) return;
    if (action === "pause") setPausedFromIsland(sessionId);
    const accepted = await invoke<boolean>("control_now_playing", { observationId, sessionId, action }).catch(() => false);
    if (observation.current === observationId && ((!accepted && action === "pause") || (accepted && action === "play"))) {
      setPausedFromIsland(current => current === sessionId ? null : current);
    }
  }

  return { displayed, control, setDetails, ...volume };
}
