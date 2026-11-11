import test from "node:test";
import assert from "node:assert/strict";
import { BENCHMARK_LAUNCH, buildAutoTuneProfile, readAutoTuneProfile, validateBenchmark, type MinecraftBenchmarkResult } from "../src/services/autotune.ts";

const baseline: MinecraftBenchmarkResult = { version: 2, minecraftVersion: "26.3", runId: "test", interrupted: false,
  seed: 1, durationSeconds: 60, averageFps: 100, onePercentLow: 70, averageFrameTimeMs: 10, p95FrameTimeMs: 15,
  averageMemoryBytes: 1e9, peakMemoryBytes: 1.5e9, frames: 6000, width: 1280, height: 720, completedAt: 123 };
const hardware = { ramBytes: 16 * 1073741824, refreshRate: 60, recommendedRenderDistance: 24, recommendedSimulationDistance: 16 };
test("unknown display refresh is disclosed instead of presented as measured", () => {
  const profile = buildAutoTuneProfile({...hardware, refreshRate: undefined}, baseline);
  assert.equal(profile.targetFps, 60);
  assert.match(profile.reasons[0].detail, /fallback/);
  assert.doesNotMatch(buildAutoTuneProfile(hardware, baseline).reasons[0].detail, /fallback/);
});
test("benchmark launch supplies every required native argument", () => {
  assert.deepEqual(BENCHMARK_LAUNCH, { instanceId: "bloom-autotune-benchmark", launchMethod: "Standard window", downloadWorkers: 3, debugLogging: false });
});
test("rejects legacy, interrupted, partial and contradictory results", () => {
  for (const patch of [{version: 1}, {minecraftVersion: "26.2"}, {interrupted: true}, {runId: ""}, {durationSeconds: 3}, {frames: 20}, {averageFps: NaN}, {averageFrameTimeMs: 1}, {onePercentLow: 200}, {peakMemoryBytes: 10}]) {
    assert.throws(() => validateBenchmark({...baseline, ...patch}));
  }
  assert.doesNotThrow(() => validateBenchmark(baseline));
});
test("low-memory PCs never receive the old forced 3 GB heap", () => {
  const profile = buildAutoTuneProfile({...hardware, ramBytes: 4 * 1073741824}, baseline);
  assert.equal(profile.memoryMb, 1536);
  assert.equal(profile.confidence, "Measured with caution");
  assert.throws(() => buildAutoTuneProfile({...hardware, ramBytes: 0}, baseline));
});
test("strong baseline does not extrapolate longer distances or force heavy graphics", () => {
  const profile = buildAutoTuneProfile(hardware, baseline);
  assert.equal(profile.renderDistance, 12);
  assert.equal(profile.simulationDistance, 8);
  assert.equal(profile.graphics, "Balanced");
  assert.equal(profile.jvmProfile, "Default");
});
test("stutters and high-refresh targets reduce chunk pressure", () => {
  const profile = buildAutoTuneProfile({...hardware, refreshRate: 240}, {...baseline, onePercentLow: 20, p95FrameTimeMs: 40});
  assert.equal(profile.targetFps, 240);
  assert.equal(profile.graphics, "Fast");
  assert.equal(profile.renderDistance, 8);
  assert.equal(profile.simulationDistance, 5);
  assert.equal(profile.confidence, "Measured with caution");
});
test("damaged saved profiles cannot crash the result screen", () => {
  const profile = buildAutoTuneProfile(hardware, baseline);
  let value = JSON.stringify(profile);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: () => value } });
  assert.deepEqual(readAutoTuneProfile(), profile);
  for (const patch of [{ memoryMb: null }, { reasons: "broken" }, { graphics: "Unknown" }, { benchmark: {} }]) {
    value = JSON.stringify({...profile, ...patch}); assert.equal(readAutoTuneProfile(), null);
  }
  Reflect.deleteProperty(globalThis, "localStorage");
});
