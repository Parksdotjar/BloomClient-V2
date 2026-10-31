// Run against Vite with Playwright installed, or set PLAYWRIGHT_MODULE to its entry file.
// All native calls are simulated; no Minecraft/account/instance files are touched.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", animations: true, startupBehavior: "Remember last page", doubleClickLaunch: false }));
  const instances = ["Source", "SMP", "Creative", "Fourth", "Fifth"].map((name, index) => ({
    id: `instance-${index}`, name, loader: "Fabric", version: "1.21.1", directory: "test", java: "",
    memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true,
    config: true, customResolution: false, visible: true, shortcut: false,
  }));
  const files = { mods: "sample.jar", resourcepacks: "sample.zip", shaderpacks: "shader.zip" };
  const callbacks = new Map();
  let next = 1;
  window.transferTest = { calls: [], mode: "verified", delay: 0, copied: [] };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc(path) { return path; },
    async invoke(command, args) {
      const test = window.transferTest;
      test.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "list_pack_channel_memberships" || command === "reconcile_cosmetics" || command === "list_cached_screenshots") return [];
      if (command === "list_instance_content") return args.instanceId === "instance-0" ? [{ id: "sample", name: "Sample Content", version: "1.0", fileName: files[args.category], size: 1024, enabled: true }] : test.copied.filter(item => item.targetId === args.instanceId && item.category === args.category).map(item => ({ id: "copy", name: "Sample Content", fileName: item.fileName, size: 1024, enabled: true }));
      if (command === "preview_content_transfer") {
        if (test.delay) await new Promise(resolve => setTimeout(resolve, test.delay));
        if (test.mode === "blocked") throw "This file does not list support for Minecraft 1.21.1.";
        return { fingerprint: "test-fingerprint", verified: test.mode !== "unknown", message: test.mode === "unknown" ? "Compatibility could not be verified." : "Supports Minecraft 1.21.1." };
      }
      if (command === "copy_instance_content") { test.copied.push(args.request); return null; }
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "plugin:window|is_maximized") return false;
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
await page.route("**/*", route => {
  const url = route.request().url();
  return url.startsWith("http://127.0.0.1:1420") || url.startsWith("data:") ? route.continue() : route.abort();
});
const shotDir = process.env.TRANSFER_SCREENSHOTS;
if (shotDir) await mkdir(shotDir, { recursive: true });
const sourceRow = page.locator(".installed-content-item .content-detail-hitarea").first();
const count = command => page.evaluate(command => window.transferTest.calls.filter(call => call.command === command).length, command);
async function startDrag() {
  const bounds = await sourceRow.boundingBox();
  assert.ok(bounds);
  await page.mouse.move(bounds.x + 120, bounds.y + 22);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 90, bounds.y + 24, { steps: 4 });
  await page.locator(".content-transfer-ghost").waitFor();
}
async function dropOn(id = "instance-1") {
  const target = page.locator(`[data-content-drop-id="${id}"]`);
  await target.scrollIntoViewIfNeeded();
  const bounds = await target.boundingBox();
  await page.mouse.move(bounds.x + 60, bounds.y + bounds.height / 2, { steps: 12 });
  await page.waitForTimeout(120);
  assert.equal(await target.getAttribute("data-content-drop-active"), "true");
  if (shotDir) await page.screenshot({ path: `${shotDir}/drag.png` });
  await page.mouse.up();
}
try {
  await page.goto(process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420/");
  await page.getByRole("button", { name: "Open Source", exact: true }).click();
  await sourceRow.waitFor();
  assert.equal(await page.locator("[data-content-drop-id]").count(), 3);
  await startDrag();
  assert.equal(await page.locator("[data-content-drop-id]").count(), 5);
  await dropOn();
  await page.getByRole("dialog").getByText("Supports Minecraft 1.21.1.").waitFor();
  assert.equal(await count("copy_instance_content"), 0, "Dropping must not write files");
  if (shotDir) { await page.waitForTimeout(250); await page.screenshot({ path: `${shotDir}/confirm-oled.png` }); }
  await page.getByRole("dialog").getByRole("button", { name: "Copy to SMP", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await count("copy_instance_content"), 1);
  assert.equal(await page.locator("[data-content-drop-id]").count(), 3);
  await page.getByRole("button", { name: "Open SMP", exact: true }).click();
  await page.locator(".installed-content-item").getByText("Sample Content", { exact: true }).waitFor();
  await page.getByRole("button", { name: "Open Source", exact: true }).click();
  await sourceRow.waitFor();

  // Escape, outside drops and returning onto the source never request a preview.
  const previews = await count("preview_content_transfer");
  await startDrag();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(900); // Releasing later must still not open item details.
  await page.mouse.up();
  assert.equal(await page.locator(".content-transfer-ghost").count(), 0);
  await startDrag();
  await page.mouse.move(1100, 900);
  await page.mouse.up();
  await startDrag();
  const own = await page.locator('[data-content-drop-id="instance-0"]').boundingBox();
  await page.mouse.move(own.x + 50, own.y + 30);
  await page.mouse.up();
  assert.equal(await count("preview_content_transfer"), previews);

  // Unknown compatibility requires a deliberate acknowledgement.
  await page.evaluate(() => { window.transferTest.mode = "unknown"; });
  await startDrag();
  await dropOn("instance-4");
  await page.getByRole("button", { name: "Copy anyway" }).waitFor();
  await page.getByRole("button", { name: "Copy anyway" }).click();
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => window.transferTest.calls.filter(c => c.command === "copy_instance_content").at(-1).args.allowUnverified), true);

  // Known incompatibility blocks the action; keyboard/menu path uses the same review.
  await page.evaluate(() => { window.transferTest.mode = "blocked"; });
  await page.getByRole("button", { name: "Actions for Sample Content" }).click();
  await page.getByRole("button", { name: "Copy to instance…" }).click();
  await page.getByRole("dialog").getByRole("button", { name: /SMP/ }).click();
  await page.getByRole("alert").filter({ hasText: "does not list support" }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Copy to SMP", exact: true }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await page.evaluate(() => { window.transferTest.mode = "verified"; window.transferTest.delay = 180; });
  await startDrag();
  await dropOn();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
  assert.equal(await page.getByRole("dialog").count(), 0, "Late checks must not reopen a dismissed dialog");

  // Resource packs and shaders participate, and reduced motion disables the ghost transition.
  for (const tab of ["Resource Packs", "Shaders"]) {
    await page.getByRole("tab", { name: tab, exact: true }).click();
    await sourceRow.waitFor();
    await startDrag();
    await dropOn();
    await page.getByRole("dialog").getByText("Supports Minecraft 1.21.1.").waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Copy to SMP", exact: true }).click();
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
  assert.deepEqual(await page.evaluate(() => window.transferTest.copied.map(c => c.category)), ["mods", "mods", "resourcepacks", "shaderpacks"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await startDrag();
  assert.equal(await page.locator(".content-transfer-ghost").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  await dropOn();
  await page.getByRole("dialog").getByText("Supports Minecraft 1.21.1.").waitFor();
  if (shotDir) await page.screenshot({ path: `${shotDir}/confirm-light.png` });
  assert.equal(await page.locator(".content-transfer-dialog").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(255, 255, 255)");
  await page.keyboard.press("Escape");
  assert.deepEqual(errors, []);
  console.log("PASS: drag ghost, all targets, confirmation, copy/cache refresh, cancel, unknown/blocked compatibility, menu path, packs/shaders, Light and reduced motion.");
} catch (error) {
  console.error("Browser errors:", errors);
  console.error("Visible text:", (await page.locator("body").innerText()).slice(0, 3500));
  if (shotDir) await page.screenshot({ path: `${shotDir}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
