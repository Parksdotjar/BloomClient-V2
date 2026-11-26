import { useId, type CSSProperties, type Ref } from "react";
import { Download, X } from "lucide-react";
import type { LauncherUpdatePhase } from "../services/launcher-update";

export type DesktopLauncherUpdate = {
  version: string;
  phase: LauncherUpdatePhase;
  progress?: number;
  error?: string;
  blockedReason?: string;
  checking?: boolean;
  needsCheck?: boolean;
  request: number;
  onAction: () => void | Promise<void>;
};

const updateStages = {
  downloading: "Downloading…",
  installing: "Installing…",
  restarting: "Restarting…",
} as const;

export function DesktopIslandUpdate({ update, active, confirming, onOpen, onDismiss, focus, measure }: {
  update: DesktopLauncherUpdate;
  active: boolean;
  confirming: boolean;
  onOpen: () => void;
  onDismiss: () => void;
  focus: (node: HTMLElement | null) => void;
  measure: Ref<HTMLDivElement>;
}) {
  const errorId = useId();
  const pendingLabel = update.phase === "restartRequired" ? "Restart to finish"
    : update.phase === "retry" ? "Update interrupted" : "Update available";
  const action = update.needsCheck ? (update.checking ? "Checking…" : "Check again")
    : update.phase === "restartRequired" ? "Restart now"
      : update.phase === "retry" ? "Try again" : "Update and restart";
  const status = update.blockedReason || (update.error
    ? update.needsCheck ? "Check failed" : update.phase === "restartRequired" ? "Restart failed" : "Update interrupted"
    : undefined);
  const download = update.phase === "downloading";
  const percent = download && Number.isFinite(update.progress)
    ? Math.max(0, Math.min(100, Math.round(update.progress ?? 0))) : undefined;
  const stage = update.phase === "installing" || update.phase === "restarting" ? updateStages[update.phase] : updateStages.downloading;
  const indeterminate = download && percent === undefined;

  return <>
    <div className="desktop-island-text-measure desktop-island-update-measure" ref={measure} aria-hidden="true">
      {active ? percent === undefined ? stage : "100%" : confirming
        ? <>{status && <span>{status}</span>}{!update.blockedReason && <span>{action}</span>}</>
        : pendingLabel}
    </div>
    {active ? <>
      <div className="desktop-island-update-progress" ref={focus} tabIndex={-1} role="progressbar"
        aria-label="Updating Delight Client" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={percent} aria-valuetext={percent === undefined ? stage : undefined}>
        <span className="desktop-notification-launch-track" data-indeterminate={indeterminate || undefined} aria-hidden="true">
          <span style={{ "--launch-fill": download ? (percent ?? 0) / 100 : 1 } as CSSProperties} />
        </span>
        <span className="desktop-island-update-progress-value" aria-hidden="true">
          {percent === undefined ? stage : `${percent}%`}
        </span>
      </div>
      <span className="desktop-island-notice-announcement" role="status">{stage}</span>
    </> : confirming ? <div className="desktop-island-update-confirm" ref={focus} tabIndex={-1}
      role="group" aria-label="Confirm launcher update">
      {status && <span className="desktop-island-update-status" role="status" title={update.error || status}>{status}</span>}
      {update.error && !update.blockedReason && <span className="desktop-island-notice-announcement" id={errorId}>{update.error}</span>}
      {!update.blockedReason && <button type="button" className="desktop-launcher-update-action ceramic-action"
        disabled={update.checking} aria-describedby={update.error ? errorId : undefined} onClick={() => void update.onAction()}>{action}</button>}
      <button type="button" className="desktop-island-update-dismiss" aria-label="Dismiss update confirmation"
        title="Dismiss" onClick={onDismiss}><X size={15} aria-hidden="true" /></button>
    </div> : <button type="button" className="desktop-notification-trigger desktop-launcher-update-trigger"
      ref={focus} aria-expanded="false" onClick={onOpen}>
      <span className="desktop-launcher-update-label">{pendingLabel}</span>
      <span className="desktop-notification-trigger-icon" aria-hidden="true">
        <Download className="desktop-launcher-update-icon" size={16} strokeWidth={1.65} />
      </span>
    </button>}
  </>;
}
