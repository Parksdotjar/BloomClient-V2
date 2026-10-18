import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAnimatedAccent, sampleAccent } from '../src/services/animated-accent.ts';

test('old settings remain solid, and malformed saved stops recover safely', () => {
  assert.equal(normalizeAnimatedAccent({}).accentMode, 'solid');
  assert.equal(normalizeAnimatedAccent({ accentStops: [{ id: 'bad', color: 'red', position: NaN }] }).accentStops.length, 3);
});
test('persisted gradients enforce five colors, unique identities and bounded controls', () => {
  const value = normalizeAnimatedAccent({ accentMode: 'animated', accentStops: Array.from({ length: 8 }, () => ({ id: 'duplicate', color: '#ffffff', position: 200 })), accentDuration: 1, accentIntensity: -30 });
  assert.equal(value.accentStops.length, 5);
  assert.equal(new Set(value.accentStops.map(s => s.id)).size, 5);
  assert.ok(value.accentStops.every(s => s.position === 100));
  assert.equal(value.accentDuration, 4);
  assert.equal(value.accentIntensity, 0);
});
test('moving a color stop changes the fade and unordered stops are interpolated correctly', () => {
  const stops = [{ id: 'white', color: '#ffffff', position: 80 }, { id: 'black', color: '#000000', position: 20 }];
  assert.equal(sampleAccent(stops, 0), '#000000');
  assert.equal(sampleAccent(stops, 50), '#808080');
  assert.equal(sampleAccent(stops, 100), '#ffffff');
  assert.equal(sampleAccent([{ ...stops[0], position: 40 }, stops[1]], 40), '#ffffff');
});
test('coincident stops create a deterministic hard transition without invalid colors', () => {
  const stops = [{ id: 'a', color: '#ff0000', position: 50 }, { id: 'b', color: '#0000ff', position: 50 }];
  assert.equal(sampleAccent(stops, 49), '#ff0000');
  assert.equal(sampleAccent(stops, 50), '#0000ff');
});
test('zero intensity neutralizes saturation and full intensity preserves chosen colors', () => {
  const stops = [{ id: 'a', color: '#ff0000', position: 0 }, { id: 'b', color: '#0000ff', position: 100 }];
  assert.equal(sampleAccent(stops, 0), '#ff0000');
  assert.equal(sampleAccent(stops, 0, 0), '#363636');
});
