import { invoke } from "./invoke";
import { ScreenshotCache, screenshotKey, type ScreenshotShot } from "./screenshot-cache";
export type { ScreenshotShot } from "./screenshot-cache";
type Shelf = { items: ScreenshotShot[]; warnings: string[] };
export const screenshotImages = new ScreenshotCache(async (shot, kind) => {
  const src = await invoke<string>("screenshot_action", { instanceId: shot.instanceId, name: shot.name, action: kind });
  const decoded = new Image();
  decoded.src = src;
  await decoded.decode();
  return { src, decoded, cost: src.length * 2 + decoded.naturalWidth * decoded.naturalHeight * 4 };
});
let shelf: Shelf | null = null;
let listing: Promise<Shelf> | null = null;
let generation = 0;
let paused = false;
export function setScreenshotActivity(busy: boolean) {
  paused = busy;
  screenshotImages.setPaused(busy);
}
const warmed = new Set<string>();
const listeners = new Set<(value: Shelf) => void>();
export function subscribeScreenshotShelf(listener: (value: Shelf) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export const cachedScreenshotShelf = () => shelf;
export function listScreenshots(): Promise<Shelf> {
  if (listing) return listing;
  const current = generation;
  const request = invoke<Shelf>("list_screenshots").then(value => { if (generation === current) {
    shelf = value;
    for (const listener of listeners) listener(value);
  } return value; });
  listing = request;
  void request.finally(() => { if (listing === request) listing = null; }).catch(() => {});
  return request;
}
export function warmScreenshots(shots: ScreenshotShot[], priority = 10) {
  for (const shot of shots) {
    for (const kind of ["thumbnail", "preview"] as const) {
      const key = screenshotKey(shot, kind);
      if (warmed.has(key)) {
        // Promote visible queued previews; also restore them if hot memory evicted them.
        if (priority > 10) void screenshotImages.get(shot, kind, priority).catch(() => { warmed.delete(key); });
        continue;
      }
      warmed.add(key);
      void screenshotImages.get(shot, kind, priority).catch(() => { warmed.delete(key); });
    }
  }
}
// Discovery and warming continue while navigating elsewhere in the launcher.
export function startScreenshotWarming() {
  let stopped = false;
  const refresh = () => { if (!paused && !document.hidden) void listScreenshots().then(value => { if (!stopped && !paused) { if (!listeners.size) screenshotImages.prefer(value.items); warmScreenshots(value.items); } }).catch(() => {}); };
  const timer = window.setTimeout(refresh, 1200);
  const interval = window.setInterval(refresh, 30_000);
  const visible = () => { if (!document.hidden) refresh(); };
  document.addEventListener("visibilitychange", visible);
  return () => { stopped = true; window.clearTimeout(timer); window.clearInterval(interval); document.removeEventListener("visibilitychange", visible); };
}
window.addEventListener("bloom-clear-transient-caches", () => {
  generation++; shelf = null; listing = null; warmed.clear(); screenshotImages.clear();
});
