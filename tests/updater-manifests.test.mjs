import assert from "node:assert/strict";
import test from "node:test";
import { mergeUpdaterManifests } from "../scripts/merge-updater-manifests.mjs";

const windows = { version: "1.2.3", notes: "Release notes", pub_date: "2026-11-10T00:00:00Z", platforms: {
  "windows-x86_64": { url: "https://example.com/setup.exe", signature: "windows-fixture" },
  "windows-x86_64-nsis": { url: "https://example.com/setup.exe", signature: "windows-fixture" },
} };
const mac = { version: "1.2.3", platforms: { "darwin-aarch64": { url: "https://example.com/Bloom.app.tar.gz", signature: "mac-fixture" } } };
test("adding Mac preserves every Windows URL, signature and release metadata", () => {
  const before = JSON.stringify(windows);
  const merged = mergeUpdaterManifests([windows, mac]);
  assert.equal(JSON.stringify(windows), before);
  assert.deepEqual(merged, { ...windows, platforms: { ...windows.platforms, ...mac.platforms } });
  assert.deepEqual(mergeUpdaterManifests([windows, windows]), windows);
});
test("rejects mismatched versions, conflicting targets and unsigned artifacts", () => {
  assert.throws(() => mergeUpdaterManifests([windows, { ...mac, version: "1.2.4" }]), /different versions/);
  assert.throws(() => mergeUpdaterManifests([windows, { version: windows.version, platforms: {
    "windows-x86_64": { url: "https://example.com/different.exe", signature: "different" },
  } }]), /Conflicting/);
  for (const patch of [{ signature: "" }, { url: "http://example.com/insecure" }]) {
    assert.throws(() => mergeUpdaterManifests([windows, { ...mac, platforms: { "darwin-aarch64": { ...mac.platforms["darwin-aarch64"], ...patch } } }]), /Invalid/);
  }
});
