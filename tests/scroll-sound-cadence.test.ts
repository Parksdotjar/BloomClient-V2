import assert from "node:assert/strict";
import { test } from "node:test";
import { ScrollSoundCadence } from "../src/services/scroll-sound-cadence.ts";

const sample = (distance: number, frames = 120) => {
  const cadence = new ScrollSoundCadence();
  const times: number[] = [];
  for (let frame = 0; frame < frames; frame++) if (cadence.advance(distance, frame * 16)) times.push(frame * 16);
  return times;
};

test("scroll cadence accelerates with actual movement and stays bounded", () => {
  const slow = sample(1), medium = sample(4), fast = sample(32);
  assert.ok(slow.length >= 4);
  assert.ok(medium.length > slow.length * 3);
  assert.ok(fast.length > medium.length * 2);
  for (let i = 1; i < fast.length; i++) assert.ok(fast[i] - fast[i - 1] >= 25);
});

test("cadence decelerates naturally as a gesture's movement slows", () => {
  const cadence = new ScrollSoundCadence();
  const fast: number[] = [], slow: number[] = [];
  for (let i = 0; i < 120; i++) if (cadence.advance(i < 60 ? 24 : 2, i * 16)) (i < 60 ? fast : slow).push(i * 16);
  assert.ok(fast.length > slow.length * 4);
  assert.ok(slow[slow.length - 1] - slow[slow.length - 2] > fast[fast.length - 1] - fast[fast.length - 2]);
});

test("fractional trackpad deltas accumulate rather than disappearing between inputs", () => {
  const cadence = new ScrollSoundCadence();
  for (let i = 0; i < 47; i++) assert.equal(cadence.advance(0.5, i * 16), false);
  assert.equal(cadence.advance(0.5, 47 * 16), true);
});

test("a page jump never queues a train of ticks after movement stops", () => {
  const cadence = new ScrollSoundCadence();
  assert.equal(cadence.advance(2400, 0), true);
  for (let time = 16; time <= 1000; time += 16) assert.equal(cadence.advance(0, time), false);
  assert.equal(cadence.advance(1, 1016), false);
});

test("pauses and resets discard an old gesture's fractional distance", () => {
  const cadence = new ScrollSoundCadence();
  assert.equal(cadence.advance(23, 0), false);
  assert.equal(cadence.advance(1, 300), false);
  assert.equal(cadence.advance(22, 316), false);
  cadence.reset();
  assert.equal(cadence.advance(1, 332), false);
});

test("invalid movement and clocks cannot poison the next real movement", () => {
  const cadence = new ScrollSoundCadence();
  for (const distance of [NaN, Infinity, -1, 0]) assert.equal(cadence.advance(distance, 0), false);
  assert.equal(cadence.advance(24, NaN), false);
  assert.equal(cadence.advance(24, 16), true);
  assert.equal(cadence.advance(24, 0), true);
});
