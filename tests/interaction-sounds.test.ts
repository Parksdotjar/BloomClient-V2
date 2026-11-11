import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import {
  configureInteractionSounds,
  defaultInteractionSounds,
  disposeInteractionSounds,
  normalizeInteractionSounds,
  playInteractionSound,
  stopInteractionSounds,
  synthesizeInteractionSound,
  type SoundCue,
} from "../src/services/interaction-sounds.ts";

const cues: SoundCue[] = ["button", "toggleOn", "toggleOff", "scroll", "success"];
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const originalAudioContext = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");
let hidden = false;
let focused = true;
let failResume = false;
let failStart = false;
let suspendAtCreation = false;
let resumeDelay = 0;
let contexts: FakeContext[] = [];

class FakeSource {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  disconnected = false;
  stopped = false;
  started = false;
  connect() {}
  disconnect() { this.disconnected = true; }
  start() {
    if (failStart) throw new Error("device failed");
    this.started = true;
  }
  stop() { this.stopped = true; }
  end() { this.onended?.(); }
}

class FakeContext {
  state = suspendAtCreation ? "suspended" : "running";
  currentTime = 0;
  destination = {};
  sources: FakeSource[] = [];
  bufferCount = 0;
  suspendCount = 0;
  gain = {
    value: 0,
    cancelScheduledValues() {},
    setTargetAtTime(value: number) { this.value = value; },
  };
  constructor() { contexts.push(this); }
  createGain() { return { gain: this.gain, connect() {}, disconnect() {} }; }
  createBuffer(_channels: number, length: number, sampleRate: number) {
    this.bufferCount += 1;
    const channel = new Float32Array(length);
    return { duration: length / sampleRate, getChannelData: () => channel };
  }
  createBufferSource() { const source = new FakeSource(); this.sources.push(source); return source; }
  async resume() {
    if (failResume) throw new Error("audio unavailable");
    if (resumeDelay) await new Promise(resolve => setTimeout(resolve, resumeDelay));
    this.state = "running";
  }
  async suspend() { this.state = "suspended"; this.suspendCount += 1; }
  async close() { this.state = "closed"; }
}

beforeEach(() => {
  hidden = false; focused = true; failResume = false; failStart = false;
  suspendAtCreation = false; resumeDelay = 0; contexts = [];
  Object.defineProperty(globalThis, "document", { configurable: true, value: { get hidden() { return hidden; }, hasFocus: () => focused } });
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeContext });
  configureInteractionSounds(defaultInteractionSounds);
});

afterEach(() => {
  disposeInteractionSounds();
  if (originalDocument) Object.defineProperty(globalThis, "document", originalDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (originalAudioContext) Object.defineProperty(globalThis, "AudioContext", originalAudioContext);
  else Reflect.deleteProperty(globalThis, "AudioContext");
});

const enable = (override = {}) => configureInteractionSounds({ ...defaultInteractionSounds, enabled: true, ...override });

test("old, missing and malformed preferences remain opt-in with bounded values", () => {
  for (const invalid of [undefined, null, [], "enabled", 4]) assert.deepEqual(normalizeInteractionSounds(invalid), defaultInteractionSounds);
  const recovered = normalizeInteractionSounds({ enabled: "true", volume: Infinity, depth: -50, echo: 999, categories: { buttons: false, scroll: true, success: "false" } });
  assert.equal(recovered.enabled, false);
  assert.equal(recovered.volume, 35);
  assert.equal(recovered.depth, 0);
  assert.equal(recovered.echo, 100);
  assert.deepEqual(recovered.categories, { buttons: false, toggles: true, scroll: true, success: true });
  recovered.categories.buttons = true;
  assert.equal(defaultInteractionSounds.categories.buttons, true);
});

test("every sound stays finite, brief and below its safe peak at all tone extremes", () => {
  for (const cue of cues) for (const depth of [0, 60, 100]) for (const echo of [0, 20, 100]) {
    const samples = synthesizeInteractionSound(cue, { depth, echo });
    assert.ok(samples.length <= 24_000 * 0.36);
    assert.equal(samples[0], 0);
    assert.equal(samples.at(-1), 0);
    let peak = 0;
    for (const value of samples) { assert.ok(Number.isFinite(value)); peak = Math.max(peak, Math.abs(value)); }
    assert.ok(peak > 0.15 && peak <= 0.521, `${cue} peak ${peak}`);
    assert.ok(samples.slice(-200).every(value => Math.abs(value) < 0.005), `${cue} fades to silence`);
  }
});

test("cues have distinct timbres and scroll is quieter; depth and echo alter actual audio", () => {
  const rendered = cues.map(cue => synthesizeInteractionSound(cue));
  for (let i = 0; i < rendered.length; i += 1) for (let j = i + 1; j < rendered.length; j += 1) assert.notDeepEqual(rendered[i], rendered[j]);
  const peak = (samples: Float32Array) => samples.reduce((max, value) => Math.max(max, Math.abs(value)), 0);
  assert.ok(peak(rendered[3]) < peak(rendered[0]) * 0.5);
  assert.notDeepEqual(synthesizeInteractionSound("button", { depth: 0 }), synthesizeInteractionSound("button", { depth: 100 }));
  assert.notDeepEqual(synthesizeInteractionSound("button", { echo: 0 }), synthesizeInteractionSound("button", { echo: 100 }));
  assert.deepEqual(synthesizeInteractionSound("button"), synthesizeInteractionSound("button"));
});

test("toggle travel is audible before a distinct landing and on lands higher than off", () => {
  const rate = 24_000;
  const rms = (samples: Float32Array, start: number, end: number) => {
    const window = samples.slice(Math.round(start * rate), Math.round(end * rate));
    return Math.sqrt(window.reduce((sum, value) => sum + value * value, 0) / window.length);
  };
  const pitch = (samples: Float32Array) => {
    const window = samples.slice(Math.round(0.191 * rate), Math.round(0.239 * rate));
    let peak = 0, bestFrequency = 0;
    for (let frequency = 300; frequency <= 1_300; frequency += 5) {
      let real = 0, imaginary = 0;
      for (let i = 0; i < window.length; i += 1) {
        const value = window[i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (window.length - 1)));
        real += value * Math.cos(2 * Math.PI * frequency * i / rate);
        imaginary += value * Math.sin(2 * Math.PI * frequency * i / rate);
      }
      const power = real * real + imaginary * imaginary;
      if (power > peak) { peak = power; bestFrequency = frequency; }
    }
    return bestFrequency;
  };
  for (const depth of [0, 60, 100]) {
    const on = synthesizeInteractionSound("toggleOn", { depth, echo: 0 });
    const off = synthesizeInteractionSound("toggleOff", { depth, echo: 0 });
    for (const sound of [on, off]) {
      assert.ok(rms(sound, 0.04, 0.14) > 0.01, "travel contains the sweep");
      assert.ok(rms(sound, 0.181, 0.210) > rms(sound, 0.04, 0.14) * 2, "the landing is a distinct event");
    }
    assert.ok(pitch(on) > pitch(off) * 1.5, "on and off land at perceptibly different pitches");
  }
});

test("scroll ticks stay short and dry even with maximum echo", () => {
  const tick = synthesizeInteractionSound("scroll", { echo: 0 });
  assert.ok(tick.length / 24_000 < 0.04);
  assert.deepEqual(tick, synthesizeInteractionSound("scroll", { echo: 100 }));
});

test("disabled audio creates no device or buffers, including unsolicited completion cues", async () => {
  for (const cue of cues) assert.equal(await playInteractionSound(cue), false);
  assert.equal(contexts.length, 0);
});

test("categories are independent and explicit preview does not enable them", async () => {
  enable({ categories: { buttons: false, toggles: true, scroll: false, success: false } });
  assert.equal(await playInteractionSound("button"), false);
  assert.equal(await playInteractionSound("scroll"), false);
  assert.equal(await playInteractionSound("success"), false);
  assert.equal(await playInteractionSound("toggleOn"), true);
  assert.equal(await playInteractionSound("button", { preview: true }), true);
  assert.equal(contexts[0].sources.length, 2);
  stopInteractionSounds();
  assert.equal(await playInteractionSound("button"), false);
});

test("preview works with master off but honors zero volume, hidden windows and performance block", async () => {
  assert.equal(await playInteractionSound("button", { preview: true }), true);
  configureInteractionSounds({ ...defaultInteractionSounds, volume: 0 });
  assert.equal(await playInteractionSound("toggleOn", { preview: true }), false);
  configureInteractionSounds(defaultInteractionSounds, true);
  assert.equal(await playInteractionSound("success", { preview: true }), false);
  configureInteractionSounds(defaultInteractionSounds);
  hidden = true;
  assert.equal(await playInteractionSound("button", { preview: true }), false);
  hidden = false; focused = false;
  assert.equal(await playInteractionSound("button", { preview: true }), false);
});

test("muting or disabling a category cancels current playback immediately", async () => {
  enable();
  assert.equal(await playInteractionSound("button"), true);
  const source = contexts[0].sources[0];
  enable({ categories: { buttons: false } });
  assert.equal(source.stopped, true);
  assert.equal(source.disconnected, true);
  assert.equal(await playInteractionSound("button"), false);
  assert.equal(await playInteractionSound("success"), true);
  configureInteractionSounds(defaultInteractionSounds);
  assert.equal(contexts[0].sources[1].stopped, true);
});

test("sample cache is reused and replaced when depth or echo changes", async () => {
  enable();
  await playInteractionSound("button");
  stopInteractionSounds();
  await playInteractionSound("button");
  assert.equal(contexts[0].bufferCount, 1);
  enable({ depth: 80 });
  stopInteractionSounds();
  await playInteractionSound("button");
  assert.equal(contexts[0].bufferCount, 2);
});

test("rapid scroll/toggle events do not create a sound backlog or exceed four voices", async () => {
  enable({ categories: { buttons: true, toggles: true, scroll: true, success: true } });
  assert.equal(await playInteractionSound("scroll"), true);
  for (let i = 0; i < 50; i += 1) assert.equal(await playInteractionSound("scroll"), false);
  assert.equal(await playInteractionSound("button"), true);
  assert.equal(await playInteractionSound("toggleOn"), true);
  assert.equal(await playInteractionSound("success"), true);
  assert.equal(contexts[0].sources.length, 4);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(await playInteractionSound("scroll"), false);
  contexts[0].sources[0].end();
  assert.equal(await playInteractionSound("scroll"), true);
});

test("rapid reversal cancels the old toggle sweep and its pending landing", async () => {
  enable();
  assert.equal(await playInteractionSound("toggleOn"), true);
  const old = contexts[0].sources[0];
  assert.equal(await playInteractionSound("toggleOff"), true);
  assert.equal(old.stopped, true);
  assert.equal(old.disconnected, true);
  assert.equal(contexts[0].sources[1].stopped, false);
});

test("scroll supports rapid ticks while a deliberate click can replace a full scroll voice", async () => {
  enable({ categories: { buttons: true, toggles: true, scroll: true, success: true } });
  for (let i = 0; i < 4; i += 1) {
    if (i) await new Promise(resolve => setTimeout(resolve, 25));
    assert.equal(await playInteractionSound("scroll"), true);
  }
  assert.equal(await playInteractionSound("button"), true);
  assert.equal(contexts[0].sources[0].stopped, true);
  assert.equal(contexts[0].sources.filter(source => source.started && !source.stopped).length, 4);
});

test("a reversal during resume cannot later play the stale toggle direction", async () => {
  enable(); suspendAtCreation = true; resumeDelay = 20;
  const pending = playInteractionSound("toggleOn");
  assert.equal(await playInteractionSound("toggleOff"), false);
  assert.equal(await pending, false);
  assert.equal(contexts[0].sources.length, 0);
});

test("unavailable audio and rejected resume never reject the UI action", async () => {
  enable();
  Reflect.deleteProperty(globalThis, "AudioContext");
  assert.equal(await playInteractionSound("button"), false);
  Object.defineProperty(globalThis, "AudioContext", { configurable: true, value: FakeContext });
  suspendAtCreation = true; failResume = true;
  assert.equal(await playInteractionSound("button"), false);
  failResume = false;
  assert.equal(await playInteractionSound("button"), true);
});

test("a delayed resume drops its cue and concurrent events instead of replaying them", async () => {
  enable(); suspendAtCreation = true; resumeDelay = 230;
  const delayed = playInteractionSound("button");
  assert.equal(await playInteractionSound("toggleOn"), false);
  assert.equal(await delayed, false);
  await new Promise(resolve => setTimeout(resolve, 70));
  assert.equal(contexts[0].sources.length, 0);
});

test("changing permissions during audio resume prevents stale playback", async () => {
  enable(); suspendAtCreation = true; resumeDelay = 20;
  const pending = playInteractionSound("button");
  configureInteractionSounds(defaultInteractionSounds);
  assert.equal(await pending, false);
  assert.equal(contexts[0].sources.length, 0);
});

test("device start failure releases its voice and disposal closes the context", async () => {
  enable(); failStart = true;
  assert.equal(await playInteractionSound("button"), false);
  assert.equal(contexts[0].sources[0].disconnected, true);
  failStart = false;
  stopInteractionSounds();
  assert.equal(await playInteractionSound("button"), true);
  disposeInteractionSounds();
  assert.equal(contexts[0].state, "closed");
  assert.equal(contexts[0].sources[1].stopped, true);
});

test("audio context suspends after the last one-shot finishes", async () => {
  enable();
  assert.equal(await playInteractionSound("button"), true);
  contexts[0].sources[0].end();
  await new Promise(resolve => setTimeout(resolve, 800));
  assert.equal(contexts[0].state, "suspended");
  assert.equal(contexts[0].suspendCount, 1);
});
