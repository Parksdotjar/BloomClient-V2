import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

// Test the actual service on the same Node versions as the frontend build.
const source = readFileSync(new URL("../src/services/launcher-update.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
});
const { runLauncherUpdate } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);

test("download progress uses byte counts and installation waits for the verified package", async () => {
  const attempt = { stage: "ready" };
  const phases = [];
  const progress = [];
  const operations = [];
  let resolveDownload;
  const update = {
    download(report) {
      operations.push("download");
      report({ event: "Started", data: { contentLength: 2000 } });
      report({ event: "Progress", data: { chunkLength: 900 } });
      report({ event: "Finished" });
      return new Promise(resolve => { resolveDownload = resolve; });
    },
    async install() { operations.push("install"); },
  };
  const operation = runLauncherUpdate(update, attempt, {
    onPhase: phase => phases.push(phase),
    onProgress: value => progress.push(value),
    restart: async () => { operations.push("restart"); },
  });
  assert.deepEqual(progress, [undefined, 0, 45]);
  assert.deepEqual(phases, ["downloading"]);
  assert.deepEqual(operations, ["download"]);
  assert.equal(attempt.stage, "ready", "Finished alone does not authorize installation");

  resolveDownload();
  await operation;
  assert.deepEqual(progress, [undefined, 0, 45, 100]);
  assert.deepEqual(phases, ["downloading", "installing", "restarting"]);
  assert.deepEqual(operations, ["download", "install", "restart"]);
  assert.equal(attempt.stage, "installed");
});

test("an update with no byte total stays indeterminate and a download failure can be retried", async () => {
  const attempt = { stage: "ready" };
  const progress = [];
  const operations = [];
  const update = {
    async download(report) {
      operations.push("failed download");
      report({ event: "Started", data: {} });
      report({ event: "Progress", data: { chunkLength: 800 } });
      throw new Error("Signature check failed");
    },
    async install() { operations.push("install"); },
  };
  const options = {
    onPhase() {},
    onProgress: value => progress.push(value),
    restart: async () => { operations.push("restart"); },
  };
  await assert.rejects(runLauncherUpdate(update, attempt, options), /signature check failed/i);
  assert.equal(attempt.stage, "ready");
  assert.deepEqual(progress, [undefined, undefined]);
  assert.deepEqual(operations, ["failed download"]);

  update.download = async () => { operations.push("verified download"); };
  await runLauncherUpdate(update, attempt, options);
  assert.deepEqual(operations, ["failed download", "verified download", "install", "restart"]);
});

test("retries preserve both the verified download and a completed installation", async () => {
  const attempt = { stage: "ready" };
  const operations = [];
  let failInstall = true;
  let failRestart = true;
  const update = {
    async download() { operations.push("download"); },
    async install() {
      operations.push("install");
      if (failInstall) {
        failInstall = false;
        throw new Error("Installer interrupted");
      }
    },
  };
  const options = {
    onPhase() {},
    onProgress() {},
    async restart() {
      operations.push("restart");
      if (failRestart) {
        failRestart = false;
        throw new Error("Restart interrupted");
      }
    },
  };
  await assert.rejects(runLauncherUpdate(update, attempt, options), /installer interrupted/i);
  assert.equal(attempt.stage, "downloaded");
  await assert.rejects(runLauncherUpdate(update, attempt, options), /restart interrupted/i);
  assert.equal(attempt.stage, "installed");
  await runLauncherUpdate(update, attempt, options);
  assert.deepEqual(operations, ["download", "install", "install", "restart", "restart"]);
});
