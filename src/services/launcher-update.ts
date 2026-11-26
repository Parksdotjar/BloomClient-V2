import type { DownloadEvent, Update } from "@tauri-apps/plugin-updater";

export type LauncherUpdatePhase =
  | "ready" | "downloading" | "installing" | "restarting" | "retry" | "restartRequired";

export type UpdateAttempt = { stage: "ready" | "downloaded" | "installed" };
type UpdateTransport = Pick<Update, "download" | "install">;

export async function runLauncherUpdate(update: UpdateTransport, attempt: UpdateAttempt, {
  onPhase, onProgress, restart,
}: {
  onPhase: (phase: LauncherUpdatePhase) => void;
  onProgress: (progress: number | undefined) => void;
  restart: () => Promise<void>;
}) {
  if (attempt.stage === "ready") {
    onPhase("downloading");
    onProgress(undefined);
    let downloaded = 0;
    let total: number | undefined;
    const report = (event: DownloadEvent) => {
      if (event.event === "Started") {
        const size = event.data.contentLength;
        total = size && size > 0 && Number.isFinite(size) ? size : undefined;
        onProgress(total ? 0 : undefined);
      } else if (event.event === "Progress") {
        downloaded += event.data.chunkLength;
        if (total) onProgress(Math.min(100, (downloaded / total) * 100));
      }
    };
    // The SDK's Finished event precedes signature verification. A resolved
    // download is the boundary that makes the installer safe to hand off.
    await update.download(report);
    attempt.stage = "downloaded";
    onProgress(100);
  }
  if (attempt.stage === "downloaded") {
    onPhase("installing");
    await update.install();
    attempt.stage = "installed";
  }
  // On Windows the installer takes over and exits the process. Other platforms
  // return from install and use the normal application relaunch here.
  onPhase("restarting");
  await restart();
}

export function launcherUpdateDelay(ms: number) {
  return new Promise<void>(resolve => window.setTimeout(resolve, ms));
}

export const previewLauncherUpdate: UpdateTransport = {
  async download(onEvent) {
    const size = 20;
    onEvent?.({ event: "Started", data: { contentLength: size } });
    for (let received = 0; received < size; received++) {
      await launcherUpdateDelay(65);
      onEvent?.({ event: "Progress", data: { chunkLength: 1 } });
    }
    onEvent?.({ event: "Finished" });
  },
  install: () => launcherUpdateDelay(500),
};
