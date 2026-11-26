import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { formatBytes } from "../services/format-bytes";

type InstallProgress = {
  link: string;
  message: string;
  progress: number;
  downloadedBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
};

function transferAmount(bytes?: number) {
  if (!bytes || !Number.isFinite(bytes) || bytes <= 0) return "";
  return bytes < 1024 ? Math.ceil(bytes) + " B" : formatBytes(bytes);
}

export function PlayerInstallBar({ link }: { link: string | null }) {
  const activeLink = useRef(link);
  const [progress, setProgress] = useState<InstallProgress | null>(null);
  useLayoutEffect(() => {
    activeLink.current = link;
    // Keep the last native reading visible as the bar fades after navigation.
    if (link) setProgress(null);
  }, [link]);
  useEffect(() => {
    let mounted = true;
    const subscription = listen<InstallProgress>("workspace-install-progress", ({ payload }) => {
      if (mounted && payload.link === activeLink.current && Number.isFinite(payload.progress)) setProgress(payload);
    }).catch(() => undefined);
    return () => {
      mounted = false;
      void subscription.then(unlisten => unlisten?.()).catch(() => {});
    };
  }, []);

  const percent = progress ? Math.max(0, Math.min(100, progress.progress)) : undefined;
  const stage = progress?.message || "Preparing installation…";
  const downloaded = transferAmount(progress?.downloadedBytes);
  const total = transferAmount(progress?.totalBytes);
  const rate = transferAmount(progress?.bytesPerSecond);
  return <section className="player-install-bar" data-active={link !== null} aria-label="Pack download" aria-hidden={link === null}>
    <div className="player-install-label">
      <span role="status" title={stage}>{stage}</span>
      {percent !== undefined && <span aria-hidden="true">{percent}%</span>}
    </div>
    <progress aria-label="Pack installation" max={100} value={percent} />
    {downloaded && <small>{downloaded}{total && " of " + total}{rate && " · " + rate + "/s"}</small>}
  </section>;
}
