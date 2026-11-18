// Real React controls with isolated native fixtures: no user files or downloads change.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", animations: true, buttonPressDuration: 0, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") }));
  const instances = [{ id: "smp", name: "SMP", loader: "Fabric", version: "26.3", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }];
  const catalog = ["Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot", "Golf", "Hotel"].map(title => ({ provider: "Modrinth", projectId: title.toLowerCase(), slug: title.toLowerCase(), title, summary: "", author: "Fixture", downloads: 100, loader: "Fabric", gameVersion: "26.3", versionId: "v1", versionNumber: "1.0", fileName: title + ".jar", fileSize: 1024 }));
  const callbacks = new Map(), listeners = new Map();
  let next = 1;
  const saved = JSON.parse(sessionStorage.getItem("test-native-queue") || "null");
  const queue = saved || { sessionId: "native-session", revision: 0, tasks: [] };
  const test = window.queueTest = {
    queue, calls: [], holdPoll: false, releasePoll: null, failPoll: false,
    gameProgress: { instanceId: "", state: "idle", progress: 0, message: "" },
    emit(event, payload) { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload: structuredClone(payload) }); },
    save(emit = true) { sessionStorage.setItem("test-native-queue", JSON.stringify(queue)); if (emit) test.emit("content-downloads-changed", queue); },
    transition(id, state, extra = {}, emit = true) {
      const task = queue.tasks.find(task => task.id === id);
      Object.assign(task, extra, { state, revision: ++queue.revision });
      if (["installed", "error", "cancelled"].includes(state)) task.completedAt = Date.now();
      if (state === "installed") task.progress = 100;
      test.save(emit);
    },
    start(emit = true) {
      if (queue.tasks.some(task => ["installing", "cancelling"].includes(task.state))) return;
      const task = queue.tasks.find(task => task.state === "queued");
      if (task) test.transition(task.id, "installing", { message: "Downloading files" }, emit);
    },
    finish(id, state = "installed", emit = true) {
      test.transition(id, state, { message: state === "error" ? "Network unavailable" : state }, false);
      test.start(false); test.save(emit);
    },
    progress(id, progress) { test.transition(id, "installing", { progress, downloadedBytes: progress * 1024, totalBytes: 102400, bytesPerSecond: 4096 }); },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      test.calls.push({ command, args });
      if (command === "plugin:event|listen") { const id = next++; await new Promise(resolve => setTimeout(resolve, 10)); listeners.set(id, args); return id; }
      if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return null; }
      if (command === "get_content_downloads") {
        if (test.failPoll) throw "Temporary native error";
        const snapshot = structuredClone(queue);
        if (test.holdPoll) { test.holdPoll = false; await new Promise(resolve => { test.releasePoll = resolve; }); }
        return snapshot;
      }
      if (command === "install_modrinth_content") {
        if (!queue.tasks.some(task => task.projectId === args.projectId && ["queued", "installing", "cancelling"].includes(task.state))) {
          queue.tasks.push({ ...args, id: `task-${queue.revision + 1}`, instanceName: "SMP", state: "queued", message: "Waiting in queue", progress: 0, downloadedBytes: 0, totalBytes: 0, bytesPerSecond: 0, completedAt: null, revision: ++queue.revision });
          test.start(false); test.save();
        }
        return structuredClone(queue);
      }
      if (command === "cancel_content_download") {
        const task = queue.tasks.find(task => task.id === args.taskId);
        test.transition(task.id, task.state === "queued" ? "cancelled" : "cancelling");
        return structuredClone(queue);
      }
      if (command === "dismiss_content_download") { queue.tasks = queue.tasks.filter(task => task.id !== args.taskId); queue.revision++; test.save(); return structuredClone(queue); }
      if (command === "list_instances") return instances;
      if (command === "list_instance_content") return queue.tasks.filter(task => task.state === "installed").map(task => ({ id: task.id, name: task.title, projectId: task.projectId, fileName: task.title + ".jar", version: "1.0", size: 1024, enabled: true }));
      if (command === "search_modrinth_content") return { items: catalog, total: catalog.length, limit: 50, offset: 0 };
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_launch_status") return test.gameProgress;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_instance_folders"].includes(command)) return [];
      if (command === "plugin:app|version") return "test";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
const downloads = () => page.getByRole("button", { name: "Downloads", exact: true }).click();
const openCatalog = async () => {
  await page.getByRole("button", { name: "Open SMP", exact: true }).click();
  await page.getByRole("button", { name: "Add Mods", exact: true }).first().click();
  await page.locator(".catalog-item").first().waitFor();
};
const queueRows = () => page.locator(".content-download-task");
const row = title => queueRows().filter({ has: page.locator(".download-task-main b", { hasText: title }) });
const history = () => page.evaluate(() => JSON.parse(localStorage.getItem("bloom-completed-downloads") || "[]"));
const finish = (title, state = "installed", emit = true) => page.evaluate(({ title, state, emit }) => { const t = window.queueTest; t.finish(t.queue.tasks.find(task => task.title === title).id, state, emit); }, { title, state, emit });
try {
  await mkdir("logs/download-queue", { recursive: true });
  await page.goto(url); await openCatalog();
  // Four clicks in one JS turn reproduce the original burst, through actual React controls.
  await page.locator(".catalog-install").evaluateAll(buttons => buttons.slice(0, 4).forEach(button => button.click()));
  await page.getByRole("button", { name: "Delta is queued for installation", exact: true }).waitFor();
  await downloads();
  assert.equal(await queueRows().count(), 4);
  assert.equal(await page.locator('[data-state="installing"]').count(), 1);
  assert.equal(await page.locator('[data-state="queued"]').count(), 3);
  await page.evaluate(() => { const t = window.queueTest; t.progress(t.queue.tasks[0].id, 37); t.emit("minecraft-launch-progress", { state: "idle", progress: 0, message: "", instanceId: "" }); });
  await page.waitForFunction(() => document.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow") === "37");
  assert.equal(await page.locator('[data-state="queued"] [role="progressbar"]').count(), 0);
  await page.screenshot({ path: "logs/download-queue/queued.png" });
  await page.evaluate(() => { const t = window.queueTest; t.gameProgress = { state: "complete", progress: 100, message: "Minecraft ready", instanceId: "separate-game" }; t.emit("minecraft-launch-progress", t.gameProgress); });
  await page.locator(".active-task").waitFor();
  await page.waitForFunction(() => !document.querySelector(".active-task"));
  assert.equal(await queueRows().count(), 4, "Game completion expires independently of ongoing content progress");
  await page.evaluate(() => { const t = window.queueTest; t.gameProgress = { state: "idle", progress: 0, message: "", instanceId: "" }; t.emit("minecraft-launch-progress", t.gameProgress); });
  await openCatalog();
  for (const title of ["Alpha", "Bravo", "Charlie", "Delta"]) assert.equal(await page.getByRole("button", { name: `${title} is queued for installation`, exact: true }).isDisabled(), true);
  await downloads(); await page.reload(); await downloads();
  await page.waitForFunction(() => document.querySelectorAll(".content-download-task").length === 4);
  assert.equal(await row("Alpha").getByRole("progressbar").getAttribute("aria-valuenow"), "37");
  // Stale snapshots and temporary polling failure must not erase or rewind known work.
  await page.evaluate(() => { const t = window.queueTest; t.holdPoll = true; window.dispatchEvent(new Event("focus")); });
  await page.waitForFunction(() => Boolean(window.queueTest.releasePoll));
  await page.evaluate(() => { const t = window.queueTest; t.progress(t.queue.tasks[0].id, 62); t.releasePoll(); t.failPoll = true; });
  await page.waitForTimeout(750);
  assert.equal(await row("Alpha").getByRole("progressbar").getAttribute("aria-valuenow"), "62");
  // All terminal states can arrive together, including after missed intermediate events.
  await page.evaluate(() => {
    const t = window.queueTest; t.failPoll = false;
    for (const task of [...t.queue.tasks]) t.finish(task.id, "installed", false);
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForFunction(() => document.querySelectorAll(".completed-task").length === 4);
  assert.deepEqual((await history()).map(task => task.name).sort(), ["Alpha", "Bravo", "Charlie", "Delta"]);
  await page.reload(); await downloads(); await page.getByText("No active downloads", { exact: true }).waitFor();
  assert.equal((await history()).length, 4);
  await page.getByRole("button", { name: "Clear Completed", exact: true }).click();
  await page.getByText("No completed downloads yet", { exact: true }).waitFor();
  await page.reload(); await downloads(); await page.waitForTimeout(150);
  assert.deepEqual(await history(), [], "Snapshots must not resurrect cleared history");

  await openCatalog();
  for (const title of ["Echo", "Foxtrot", "Golf", "Hotel"]) await page.getByRole("button", { name: `Install ${title}`, exact: true }).click();
  await downloads();
  await page.getByRole("button", { name: "Cancel Foxtrot", exact: true }).click();
  assert.equal(await row("Foxtrot").getAttribute("data-state"), "cancelled");
  assert.equal(await row("Echo").getAttribute("data-state"), "installing");
  assert.equal(await row("Golf").getAttribute("data-state"), "queued");
  await page.getByRole("button", { name: "Cancel Echo", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Cancel Echo", exact: true }).isDisabled(), true);
  await finish("Echo", "cancelled");
  assert.equal(await row("Golf").getAttribute("data-state"), "installing");
  await finish("Golf", "error");
  await row("Golf").getByText("Network unavailable", { exact: true }).waitFor();
  assert.equal(await row("Hotel").getAttribute("data-state"), "installing");
  await page.getByRole("button", { name: "Dismiss Foxtrot", exact: true }).click();
  assert.equal(await row("Foxtrot").count(), 0);
  // Terminal recovery while the app is hidden: polling sees the completion on return.
  await finish("Hotel", "installed", false);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await page.waitForFunction(() => document.querySelectorAll(".completed-task").length === 1);
  assert.deepEqual((await history()).map(task => task.name), ["Hotel"]);
  await page.screenshot({ path: "logs/download-queue/outcomes.png" });
  await page.evaluate(() => localStorage.setItem("bloom-settings", JSON.stringify({ theme: "light", animations: false })));
  await page.setViewportSize({ width: 900, height: 720 }); await page.reload(); await downloads();
  await row("Golf").waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: "logs/download-queue/compact-light.png" });
  assert.deepEqual(errors, []);
  console.log("Download queue passed: four rapid installs, every queued row, per-task progress, navigation/reload recovery, stale snapshots, dropped events, all four completions, clear persistence, individual queued/active cancellation, failure continuation, dismissal and compact Light layout.");
} finally { await browser.close(); }
