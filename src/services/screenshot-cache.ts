export type ScreenshotShot = { instanceId: string; instanceName: string; name: string; modified: number; revision?: string };
export type ScreenshotKind = "thumbnail" | "preview";
export type CachedScreenshot = { src: string; cost: number; decoded?: unknown };
type Job = { shot: ScreenshotShot; kind: ScreenshotKind; priority: number; generation: number; resolve: (src: string) => void; reject: (error: unknown) => void; promise: Promise<string> };
export const screenshotKey = (shot: ScreenshotShot, kind: ScreenshotKind) => JSON.stringify([shot.instanceId, shot.name, shot.revision ?? shot.modified, kind]);

export class ScreenshotCache {
  private entries = new Map<string, CachedScreenshot>();
  private pending = new Map<string, Job>();
  private queue: Job[] = [];
  private running = 0;
  private used = 0;
  private generation = 0;
  private preferred = new Set<string>();
  private paused = false;
  private load: (shot: ScreenshotShot, kind: ScreenshotKind) => Promise<CachedScreenshot>;
  private capacity: number;
  private concurrency: number;
  constructor(load: (shot: ScreenshotShot, kind: ScreenshotKind) => Promise<CachedScreenshot>, capacity = 160 * 1024 * 1024, concurrency = 2) {
    this.load = load; this.capacity = capacity; this.concurrency = concurrency;
  }
  prefer(shots: ScreenshotShot[]) {
    this.preferred = new Set(shots.slice(0, 12).flatMap(shot => [screenshotKey(shot, "thumbnail"), screenshotKey(shot, "preview")]));
  }
  setPaused(paused: boolean) { this.paused = paused; this.pump(); }
  peek(shot: ScreenshotShot, kind: ScreenshotKind): string | undefined {
    const key = screenshotKey(shot, kind), value = this.entries.get(key);
    if (!value) return;
    this.entries.delete(key); this.entries.set(key, value);
    return value.src;
  }
  get(shot: ScreenshotShot, kind: ScreenshotKind, priority = 100): Promise<string> {
    const hit = this.peek(shot, kind);
    if (hit) return Promise.resolve(hit);
    const key = screenshotKey(shot, kind), existing = this.pending.get(key);
    if (existing) { existing.priority = Math.max(existing.priority, priority); this.pump(); return existing.promise; }
    let resolve!: (value: string) => void, reject!: (error: unknown) => void;
    const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
    const job = { shot, kind, priority, generation: this.generation, resolve, reject, promise };
    this.pending.set(key, job); this.queue.push(job); this.pump();
    return promise;
  }
  clear() {
    this.generation++; this.entries.clear(); this.used = 0;
    // Running requests may finish for their callers but cannot repopulate cleared memory.
    for (const job of this.queue) job.reject(new Error("Screenshot cache cleared."));
    this.queue = []; this.pending.clear();
  }
  private pump() {
    while (this.running < this.concurrency && this.queue.length) {
      this.queue.sort((a, b) => b.priority - a.priority);
      if (this.paused && this.queue[0].priority < 100) break;
      const job = this.queue.shift()!;
      const key = screenshotKey(job.shot, job.kind);
      this.running++;
      this.load(job.shot, job.kind).then(value => {
        if (job.generation === this.generation && value.cost <= this.capacity) {
          while (this.used + value.cost > this.capacity && this.entries.size) {
            const oldest = [...this.entries.keys()].find(key => !this.preferred.has(key)) ?? (job.priority >= 100 ? this.entries.keys().next().value : undefined);
            if (!oldest) break;
            this.used -= this.entries.get(oldest)!.cost; this.entries.delete(oldest);
          }
          if (this.used + value.cost <= this.capacity) { this.entries.set(key, value); this.used += value.cost; }
        }
        job.resolve(value.src);
      }).catch(job.reject).finally(() => {
        if (this.pending.get(key) === job) this.pending.delete(key);
        this.running--; this.pump();
      });
    }
  }
}
