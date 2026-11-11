import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";

const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
// Tauri merges its platform config using JSON Merge Patch (arrays replace, objects merge).
function merge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else result[key] = merge(result[key], value);
  }
  return result;
}

test("Mac packaging replaces Windows resources without changing shared identity or updater trust", () => {
  const windows = read("src-tauri/tauri.conf.json");
  const mac = merge(windows, read("src-tauri/tauri.macos.conf.json"));
  assert.deepEqual(windows.bundle.targets, ["nsis"]);
  assert.equal(windows.bundle.windows.nsis.installMode, "currentUser");
  assert.equal(windows.bundle.createUpdaterArtifacts, true);
  assert.deepEqual(mac.bundle.targets, ["app", "dmg"]);
  assert.deepEqual(mac.bundle.resources, []);
  assert.deepEqual(mac.bundle.externalBin, ["binaries/sakura"]);
  assert.deepEqual(mac.bundle.icon, ["icons/icon.icns"]);
  assert.equal(mac.identifier, windows.identifier);
  assert.deepEqual(mac.plugins.updater, windows.plugins.updater);
  assert.equal(mac.bundle.createUpdaterArtifacts, true);
  assert.equal(mac.bundle.macOS.minimumSystemVersion, "14.0");
});

test("Mac helper rejects a non-native host before running builds", { skip: process.platform === "darwin" && process.arch === "arm64" }, () => {
  const result = spawnSync(process.execPath, ["scripts/macos.mjs", "build"], { encoding: "utf8" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Apple Silicon Mac/);
});
