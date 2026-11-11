export const BENCHMARK_VERSION = "26.3";
export const BENCHMARK_INSTANCE = "bloom-autotune-benchmark";
export const BENCHMARK_LAUNCH = { instanceId: BENCHMARK_INSTANCE, launchMethod: "Standard window", downloadWorkers: 3, debugLogging: false } as const;

export type MinecraftBenchmarkResult = {
  version: number; minecraftVersion: string; runId: string; seed: number; durationSeconds: number;
  averageFps: number; onePercentLow: number; averageFrameTimeMs: number; p95FrameTimeMs: number;
  averageMemoryBytes: number; peakMemoryBytes: number; frames: number; width: number; height: number;
  completedAt: number; interrupted: boolean;
};
export type TuningHardware = { ramBytes: number; refreshRate?: number; recommendedRenderDistance: number; recommendedSimulationDistance: number };
export type AutoTuneProfile = {
  targetFps: number; memoryMb: number; jvmProfile: "Default" | "Performance"; graphics: "Fast" | "Balanced" | "High";
  renderDistance: number; simulationDistance: number; averageFps: number; onePercentLow: number; lowRatio: number;
  confidence: "Measured" | "Measured with caution"; benchmarkCompletedAt: number;
  benchmark: MinecraftBenchmarkResult;
  reasons: Array<{ title: string; detail: string; tone: "good" | "warn" | "info" }>;
};

export function validateBenchmark(value: unknown): asserts value is MinecraftBenchmarkResult {
  const b = value as MinecraftBenchmarkResult | null;
  if (!b || b.version !== 2 || b.minecraftVersion !== BENCHMARK_VERSION || !b.runId || b.interrupted !== false)
    throw new Error(`Run a fresh Minecraft ${BENCHMARK_VERSION} test and keep its window focused until it finishes.`);
  const positive = [b.durationSeconds, b.averageFps, b.onePercentLow, b.averageFrameTimeMs, b.p95FrameTimeMs,
    b.peakMemoryBytes, b.averageMemoryBytes, b.frames, b.width, b.height, b.completedAt];
  if (positive.some(n => !Number.isFinite(n) || n <= 0) || b.durationSeconds < 60 || b.durationSeconds > 180 || b.frames < 60
    || b.onePercentLow > b.averageFps * 1.05 || b.averageMemoryBytes > b.peakMemoryBytes
    || Math.abs(b.frames / b.durationSeconds - b.averageFps) > Math.max(1, b.averageFps * .02)
    || Math.abs(1000 / b.averageFrameTimeMs - b.averageFps) > Math.max(1, b.averageFps * .02))
    throw new Error("The benchmark measurements are incomplete or inconsistent. Run the test again.");
}

export function buildAutoTuneProfile(hardware: TuningHardware, benchmark: MinecraftBenchmarkResult): AutoTuneProfile {
  validateBenchmark(benchmark);
  const totalRamMb = Math.floor(hardware.ramBytes / 1048576);
  if (!Number.isFinite(totalRamMb) || totalRamMb < 4096) throw new Error("AutoTune needs at least 4 GB of detected system RAM. Review memory settings manually on this computer.");
  const targetFps = Math.round(Math.min(1000, Math.max(30, hardware.refreshRate || 60)));
  const lowRatio = benchmark.onePercentLow / benchmark.averageFps;
  const measuredNeed = Math.ceil((benchmark.peakMemoryBytes / 1048576 * 1.3 + 512) / 512) * 512;
  const memoryBudget = Math.floor(Math.min(8192, totalRamMb * .45, totalRamMb - 2048) / 512) * 512;
  const memoryMb = Math.min(memoryBudget, Math.max(2048, measuredNeed));
  const memoryLimited = measuredNeed > memoryBudget;
  const severeStutter = lowRatio < .5 || benchmark.p95FrameTimeMs > 1000 / targetFps * 2;
  const limitedThroughput = benchmark.averageFps < targetFps * 1.1;
  // This fixed 12/8 baseline cannot prove that longer distances or a heavier renderer are faster.
  const distance = (n: number, fallback: number) => Number.isFinite(n) ? Math.floor(n) : fallback;
  const renderDistance = Math.max(2, Math.min(limitedThroughput ? 8 : severeStutter ? 10 : 12, distance(hardware.recommendedRenderDistance, 8)));
  const simulationDistance = Math.max(5, Math.min(renderDistance, limitedThroughput || severeStutter ? 5 : 8, distance(hardware.recommendedSimulationDistance, 5)));
  const graphics = limitedThroughput || severeStutter ? "Fast" : "Balanced";
  return { targetFps, memoryMb, jvmProfile: "Default", graphics, renderDistance, simulationDistance,
    averageFps: benchmark.averageFps, onePercentLow: benchmark.onePercentLow, lowRatio,
    confidence: severeStutter || memoryLimited || limitedThroughput ? "Measured with caution" : "Measured",
    benchmarkCompletedAt: benchmark.completedAt, benchmark,
    reasons: [
      { title: "Display target", detail: hardware.refreshRate ? `${targetFps} FPS target from your display. This is a target, not a promised result.` : "60 FPS fallback because your display refresh rate was unavailable. This is a target, not a promised result.", tone: "info" },
      { title: "Rendering", detail: `${benchmark.averageFps.toFixed(1)} average FPS at ${benchmark.width} × ${benchmark.height}. ${graphics} graphics and ${renderDistance} chunks leave room for demanding worlds.`, tone: limitedThroughput ? "warn" : "good" },
      { title: "Frame consistency", detail: `${benchmark.onePercentLow.toFixed(1)} FPS 1% low; ${benchmark.p95FrameTimeMs.toFixed(2)} ms at the 95th percentile. ${severeStutter ? "Reduced distances to limit chunk and simulation pressure." : "Kept distances within the measured baseline."}`, tone: severeStutter ? "warn" : "good" },
      { title: "Memory budget", detail: `${(benchmark.peakMemoryBytes / 1073741824).toFixed(2)} GB peak Java heap; ${(memoryMb / 1024).toFixed(1)} GB recommended. ${memoryLimited ? "System RAM limits the available headroom; close heavy apps and consider memory-saving mods." : "Reserves RAM for the operating system and other apps."} Large modpacks can need more than this test.`, tone: memoryLimited ? "warn" : "info" },
      { title: "Java settings", detail: "Uses Java's default collector. Frame spikes alone cannot identify garbage collection as their cause.", tone: "info" },
      { title: "Test scope", detail: `Minecraft ${BENCHMARK_VERSION}, fixed world, 15-second warm-up and ${benchmark.durationSeconds.toFixed(0)} seconds measured. Shaders, servers, mods and other game versions can behave differently. No post-tuning FPS gain has been measured.`, tone: "info" },
    ] };
}

export function readAutoTuneProfile(): AutoTuneProfile | null {
  try {
    const profile = JSON.parse(localStorage.getItem("bloom-autotune-profile") || "null") as AutoTuneProfile | null;
    if (!profile) return null;
    validateBenchmark(profile.benchmark);
    if (profile.benchmarkCompletedAt !== profile.benchmark.completedAt) return null;
    if (![profile.memoryMb, profile.targetFps, profile.renderDistance, profile.simulationDistance].every(Number.isFinite)
      || profile.memoryMb < 1024 || profile.memoryMb > 8192 || profile.targetFps < 30 || profile.targetFps > 1000
      || profile.renderDistance < 2 || profile.renderDistance > 32 || profile.simulationDistance < 5 || profile.simulationDistance > 32
      || !["Default", "Performance"].includes(profile.jvmProfile) || !["Fast", "Balanced", "High"].includes(profile.graphics)
      || !["Measured", "Measured with caution"].includes(profile.confidence)
      || !Array.isArray(profile.reasons) || !profile.reasons.every(reason => reason && typeof reason.title === "string" && typeof reason.detail === "string")) return null;
    return profile;
  } catch { return null; }
}
