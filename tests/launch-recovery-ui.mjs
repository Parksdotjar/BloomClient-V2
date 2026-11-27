// Exercise launch lifecycle and dropped-event recovery in the real React UI.
// Native commands are intercepted; no game process or user instance is changed.
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
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", animations: true, buttonPressDuration: 750, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") }));
  const instances = ["SMP", "Creative"].map((name, i) => ({ id: String(i), name, loader: "Fabric", version: "26.3", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  const callbacks = new Map(), listeners = new Map();
  let next = 1;
  const test = window.launchTest = {
    calls: [], running: false, progress: { instanceId: "", state: "idle", progress: 0, message: "" },
    holdPoll: false, releasePoll: null, holdLaunch: false, releaseLaunch: null, failPoll: false,
    emit(event, payload) { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload }); },
    listenerCount(event) { return [...listeners.values()].filter(listener => listener.event === event).length; },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      test.calls.push({ command, args });
      if (command === "plugin:event|listen") { const id = next++; await new Promise(resolve => setTimeout(resolve, 15)); listeners.set(id, args); return id; }
      if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return null; }
      if (command === "ask_delight_scope") return "test-account";
      if (command === "ask_delight_remote" && args.body) return { result: { status: "answered", answer: "Test diagnosis", action: null, helpIds: [] } };
      if (command === "get_minecraft_launch_status") {
        if (test.failPoll) throw "Temporary connection failure";
        const snapshot = structuredClone(test.progress);
        if (test.holdPoll) { test.holdPoll = false; await new Promise(resolve => { test.releasePoll = resolve; }); }
        return snapshot;
      }
      if (command === "get_minecraft_process_running") { if (test.failPoll) throw "Temporary connection failure"; return test.running; }
      if (command === "launch_minecraft") {
        if (test.holdLaunch) { test.holdLaunch = false; await new Promise(resolve => { test.releaseLaunch = resolve; }); }
        test.progress = { instanceId: args.instanceId, state: "installing", progress: 10, message: "Preparing Minecraft" };
        return null;
      }
      if (command === "list_instances") return instances;
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_instance_folders"].includes(command)) return [];
      if (command === "plugin:app|version") return "test";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
const play = () => page.locator(".spotlight-play");
const nav = name => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true });
const focus = () => page.evaluate(() => window.dispatchEvent(new Event("focus")));
const native = (state, running = false, emit = false, message = state, percent) => page.evaluate(({ state, running, emit, message, percent }) => {
  const t = window.launchTest;
  t.running = running;
  t.progress = { ...t.progress, state, progress: percent ?? (state === "running" || state === "complete" ? 100 : state === "installing" ? 10 : 0), message };
  if (emit) { t.emit("minecraft-launch-progress", t.progress); t.emit("minecraft-process-state", running); }
}, { state, running, emit, message, percent });
const enabled = () => page.waitForFunction(() => !document.querySelector(".spotlight-play")?.disabled, null, { timeout: 8000 });
try {
  await page.goto(url);
  await play().waitFor();
  await page.waitForTimeout(850);
  await play().click();
  await page.waitForTimeout(80);
  assert.equal(await page.evaluate(() => document.documentElement.dataset.animations), "on", "Launching must not disable interface motion");
  assert(await play().isDisabled(), "Real launch stays protected");
  const progressBar = play().getByRole("progressbar", { name: "Instance launch progress" });
  const checkProgress = async percent => {
    await page.waitForFunction(value => document.querySelector(".spotlight-play .home-launch-progress")?.getAttribute("aria-valuenow") === String(value), percent);
    const buttonBox = await play().boundingBox(), fillBox = await progressBar.boundingBox();
    assert.ok(Math.abs(fillBox.x - buttonBox.x - 1) < 1, "Launch fill starts at the button's left edge");
    assert.ok(Math.abs(fillBox.width / (buttonBox.width - 2) * 100 - percent) < 1, "Painted fill tracks native percentage");
    assert.equal(await play().locator("b").first().textContent(), "Launching…");
    assert.equal(await page.locator(".pixel-play-fill").evaluate(e => getComputedStyle(e).display), "none", "Hover paint cannot cover launch progress");
    const colors = await play().evaluate(button => ({
      base: getComputedStyle(button).backgroundColor,
      fill: getComputedStyle(button.querySelector(".home-launch-progress")).backgroundColor,
      opacity: getComputedStyle(button).opacity,
    }));
    assert.notEqual(colors.base, colors.fill, "Desktop styling preserves the dim surface beside the filled portion");
    assert.equal(colors.opacity, "1", "Disabled styling must not dim the entire launch indicator");
  };
  await native("installing", false, true, "Downloading Minecraft", 17);
  await checkProgress(17);
  // Starting the process does not mean its resources and renderer are ready.
  await native("launching", true, true, "Starting Minecraft process", 63);
  await checkProgress(63);
  await mkdir("logs/home-launch", { recursive: true });
  await page.locator(".home-launch-stack").screenshot({ path: "logs/home-launch/launching-63.png" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await checkProgress(63);
  await page.locator(".home-launch-stack").screenshot({ path: "logs/home-launch/light-launching-63.png" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "oled"; });
  await native("launching", true, true, "Loading Fabric mods", 97);
  await checkProgress(97);
  await native("launching", true, true, "Loading game resources", 99);
  await checkProgress(99);
  await native("running", true, true);
  await page.waitForFunction(() => document.querySelector(".spotlight-play b")?.textContent === "Running…");
  assert.equal(await progressBar.count(), 0);
  await page.waitForTimeout(3300);
  assert.equal(await play().locator("b").first().textContent(), "Running…", "Running state survives progress dismissal");
  await native("idle", false, true); await enabled();
  assert.equal(await play().locator("b").first().textContent(), "Play");
  await play().click();
  await nav("Locker").click();
  await page.waitForTimeout(80);
  assert.equal(await nav("Locker").getAttribute("aria-current"), "page", "Navigation remains usable during launch");
  await nav("Home").click();
  await page.locator(".spotlight-select-trigger").click();
  const choice = page.getByRole("dialog", { name: "Choose instance" }).getByRole("button", { name: /Creative/ });
  await choice.click();
  assert.equal(await page.locator(".home-launch-stack h1").textContent(), "Creative", "Selector remains usable while launching");
  await native("running", true, true);
  await page.waitForTimeout(3300);
  assert(await play().isDisabled(), "A live game still blocks duplicate launch");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.animations), "on");
  await native("idle"); // Both exit events are deliberately dropped.
  await focus(); await enabled();
  for (const terminal of ["error", "cancelled", "complete"]) {
    await play().click(); await page.waitForTimeout(150);
    if (terminal === "error") await native("running", true, true);
    await native(terminal, false, false, terminal === "error" ? "Minecraft crashed (exit code 1)." : terminal);
    await focus(); await enabled();
    assert.equal(await progressBar.count(), 0, "Terminal launch states clear the progress bar");
    if (terminal === "error") {
      const toast = page.locator('.desktop-notification-center[data-face="notice"]');
      assert.equal(await page.locator(".launch-toast").count(), 0);
      await toast.locator(".desktop-island-notice-trigger").click();
      assert((await toast.textContent()).includes("Minecraft crashed (exit code 1)."));
      const count = () => page.evaluate(() => launchTest.calls.filter(x => x.command === "ask_delight_remote" && x.args?.body).length);
      const before = await count();
      await toast.getByRole("button", { name: "Share crash details" }).click();
      const preview = page.getByRole("dialog", { name: "Share crash details" });
      assert((await preview.getByRole("textbox").inputValue()).includes("exit code 1"));
      await preview.getByRole("button", { name: "Cancel" }).click();
      assert.equal(await count(), before);
      await page.getByRole("menubar", { name: "Application" }).getByRole("menuitem", { name: "View", exact: true }).click();
      await page.getByRole("menu", { name: "View" }).getByRole("menuitem", { name: "Logs", exact: true }).click();
      await page.locator(".console-actions").getByRole("button", { name: "Share crash details" }).click();
      await preview.getByRole("textbox").fill("My reviewed launch details");
      await preview.getByRole("button", { name: "Send to Alula" }).click();
      await page.getByText("Test diagnosis", { exact: true }).waitFor();
      const sent = await page.evaluate(() => launchTest.calls.filter(x => x.command === "ask_delight_remote" && x.args?.body).at(-1).args.body);
      assert.equal(sent.question, "My reviewed launch details");
      assert.deepEqual(sent.recent, []);
      await page.getByRole("dialog").getByRole("button", { name: "Close", exact: true }).click();
      await nav("Home").click();
    }
  }
  // An old delayed idle reset must not clear a new launch.
  await native("idle", false, true); await enabled();
  await play().click(); await page.waitForTimeout(950);
  assert(await play().isDisabled(), "An earlier idle event cannot unlock a newer launch");
  await native("idle", false, true); await enabled();
  // Do not let a snapshot captured before a fresh event overwrite it.
  await page.evaluate(() => { window.launchTest.holdPoll = true; });
  await focus(); await page.waitForFunction(() => window.launchTest.releasePoll);
  await native("installing", true, true);
  await page.evaluate(() => { window.launchTest.releasePoll(); window.launchTest.releasePoll = null; });
  await page.waitForTimeout(150);
  assert(await play().isDisabled(), "New events supersede an older in-flight snapshot");
  await native("idle", false, true); await enabled();
  // The command has not been accepted yet; its previous idle snapshot is stale.
  await page.evaluate(() => { window.launchTest.holdLaunch = true; });
  await play().click();
  await page.waitForFunction(() => window.launchTest.releaseLaunch);
  await focus(); await page.waitForTimeout(850);
  assert(await play().isDisabled());
  await page.evaluate(() => { window.launchTest.releaseLaunch(); window.launchTest.releaseLaunch = null; });
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.launchTest.failPoll = true; });
  await focus(); await page.waitForTimeout(800);
  assert(await play().isDisabled(), "Unavailable status must not pretend the game is idle");
  await page.evaluate(() => { window.launchTest.failPoll = false; });
  await native("idle"); await focus(); await enabled();
  assert.equal(await page.evaluate(() => window.launchTest.listenerCount("minecraft-launch-progress")), 1, "Strict Mode leaves one launch listener");
  assert.equal(await page.evaluate(() => window.launchTest.listenerCount("minecraft-process-state")), 1, "Strict Mode leaves one process listener");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).animations), true);
  for (const preferences of [{ animations: false, ultraPerformance: false }, { animations: true, ultraPerformance: true }]) {
    await page.evaluate(preferences => localStorage.setItem("bloom-settings", JSON.stringify({ ...JSON.parse(localStorage.getItem("bloom-settings")), ...preferences })), preferences);
    await page.reload(); await play().waitFor(); await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.animations), "off");
    await play().click(); await page.waitForTimeout(100);
    await native("launching", true, true, "Loading mods", 63); await checkProgress(63);
    await native("cancelled"); await focus(); await enabled();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.animations), "off", "Recovery respects the user's motion/performance settings");
  }
  assert.deepEqual(errors, []);
  console.log("Launch recovery passed: motion/navigation during launch and gameplay; dropped exit/error/cancel/complete events; stale snapshots and idle timers; pending commands; temporary polling errors; listener cleanup and retained preferences.");
} catch (error) {
  console.error("Browser errors", errors);
  console.error((await page.locator("body").innerText()).slice(-1200));
  throw error;
} finally { await browser.close(); }
