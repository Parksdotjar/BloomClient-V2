// Real Home UI with native launch intercepted: never starts Minecraft or changes user files.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#5798ff", animations: true, buttonPressDuration: 750 }));
  const instances = ["SMP", "Creative"].map((name, i) => ({ id: String(i), name, loader: "Fabric", version: "26.3", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  window.pixelTest = { calls: [] };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.pixelTest.calls.push({ command, args, time: performance.now() });
      if (command === "list_instances") return instances;
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_instance_folders"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "test";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
await mkdir("logs/pixel-play", { recursive: true });
const button = page.locator(".spotlight-play");
const fill = page.locator(".pixel-play-fill");
const clip = () => fill.evaluate(element => element.style.clipPath);
const coverage = () => fill.evaluate(element => {
  const clip = element.style.clipPath;
  if (!clip.startsWith("path(")) return { left: 0, right: 0, top: 0, bottom: 0, total: clip === "inset(0px)" ? 1 : 0 };
  const path = new Path2D(clip.slice(6, -2));
  const ctx = document.createElement("canvas").getContext("2d");
  let left = 0, right = 0, top = 0, bottom = 0;
  for (let y = 5; y < element.clientHeight; y += 10) for (let x = 5; x < element.clientWidth; x += 10) {
    if (!ctx.isPointInPath(path, x, y)) continue;
    if (x < element.clientWidth / 2) left++; else right++;
    if (y < element.clientHeight / 2) top++; else bottom++;
  }
  return { left, right, top, bottom, total: left + right };
});
const leave = async () => { await page.mouse.move(0, 0); await button.evaluate(element => element.blur()); await page.waitForTimeout(950); };
const enter = async (side) => {
  const b = await button.boundingBox();
  const x = side === "left" ? b.x + 1 : side === "right" ? b.x + b.width - 1 : b.x + b.width / 2;
  const y = side === "top" ? b.y + 1 : b.y + b.height / 2;
  await page.mouse.move(x, y);
};
async function checkLights() {
  const metrics = await page.locator(".winter-lights").evaluate(lights => {
    const panel = lights.closest("main");
    const rect = lights.getBoundingClientRect();
    const frame = panel.getBoundingClientRect();
    return { top: rect.top - frame.top - panel.clientTop, left: rect.left - frame.left - panel.clientLeft,
      right: rect.right - frame.left - panel.clientLeft - panel.clientWidth, repeat: getComputedStyle(lights).backgroundRepeat };
  });
  assert.equal(metrics.top, 0);
  assert.equal(metrics.left, 11);
  assert.ok(Math.abs(metrics.right) < 1);
  assert.equal(metrics.repeat, "round no-repeat");
}
try {
  await page.goto(url);
  await button.waitFor();
  await checkLights();
  await page.waitForTimeout(750);
  const base = await button.boundingBox();
  const pickerBase = await page.locator(".spotlight-select-trigger").boundingBox();
  await page.locator(".home-launch-stack").screenshot({ path: "logs/pixel-play/before.png" });
  await enter("left");
  await page.waitForTimeout(320);
  let pixels = await coverage();
  assert(pixels.left > 0 && pixels.right === 0, "Fill begins at the left entry point");
  await page.waitForTimeout(250);
  assert((await coverage()).total > pixels.total, "Fill creeps across the button");
  await page.locator(".home-launch-stack").screenshot({ path: "logs/pixel-play/mid-fill.png" });
  await page.waitForTimeout(500);
  assert.equal(await clip(), "inset(0px)");
  const oledPalette = await fill.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
  assert.equal(oledPalette.background, "rgb(241, 241, 241)", "OLED fill uses the current theme ink");
  assert.equal(oledPalette.color, "rgb(0, 0, 0)");
  const expanded = await button.boundingBox();
  assert(expanded.width > base.width * 1.02 && expanded.width < base.width * 1.03);
  assert.deepEqual(await page.locator(".spotlight-select-trigger").boundingBox(), pickerBase, "Selector stays stationary");
  await page.locator(".home-launch-stack").screenshot({ path: "logs/pixel-play/filled.png" });
  const settled = await clip();
  await page.waitForTimeout(100);
  assert.equal(await clip(), settled, "No looping edge noise");
  await leave();
  assert.equal(await clip(), "inset(50%)");
  await enter("right"); await page.waitForTimeout(320);
  pixels = await coverage();
  assert(pixels.right > 0 && pixels.left === 0, "Fresh entry uses the right edge");
  await page.mouse.move(0, 0); await page.waitForTimeout(90);
  const retreat = (await coverage()).total;
  await enter("right"); await page.waitForTimeout(200);
  assert((await coverage()).total > retreat, "Rapid re-entry reverses without restarting");
  await leave();
  await enter("top"); await page.waitForTimeout(190);
  pixels = await coverage();
  assert(pixels.top > pixels.bottom, "Top entry starts along the top edge");
  await page.evaluate(() => { document.documentElement.dataset.animations = "off"; });
  await page.waitForTimeout(50);
  assert.equal(await clip(), "inset(0px)");
  assert.equal(await button.evaluate(e => getComputedStyle(e).transform), "none");
  await leave();
  await page.evaluate(() => { document.documentElement.dataset.animations = "on"; document.documentElement.dataset.performance = "ultra"; });
  await enter("left"); await page.waitForTimeout(50);
  assert.equal(await clip(), "inset(0px)");
  assert.equal(await button.evaluate(e => getComputedStyle(e).transform), "none");
  await leave();
  await page.evaluate(() => { document.documentElement.dataset.performance = "normal"; });
  await page.emulateMedia({ reducedMotion: "reduce" });

  await page.keyboard.press("Tab");
  await button.focus();
  assert.equal(await button.evaluate(e => e.matches(":focus-visible")), true);
  assert.equal(await clip(), "inset(0px)");
  assert.equal(await button.evaluate(e => getComputedStyle(e).transform), "none", "Reduced-motion keyboard focus stays still");
  await leave();
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
  await enter("left"); await page.waitForTimeout(1400);
  const palette = await fill.evaluate(e => ({ background: getComputedStyle(e).backgroundColor, color: getComputedStyle(e).color }));
  assert.equal(palette.background, "rgb(27, 27, 27)");
  assert.equal(palette.color, "rgb(246, 246, 246)");
  await page.locator(".home-launch-stack").screenshot({ path: "logs/pixel-play/light.png" });
  // Resizing moves the centered button away from the pointer. Hold keyboard focus across the resize.
  await page.keyboard.press("Tab");
  await button.focus();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".pixel-play-fill")).clipPath === "inset(0px)");
  await page.setViewportSize({ width: 1000, height: 720 });
  await page.waitForTimeout(200);
  await checkLights();
  const narrow = await button.boundingBox();
  assert(narrow.x >= 0 && narrow.x + narrow.width <= 1000);
  assert.equal(await clip(), "inset(0px)", "Resize keeps completed reveal filled");
  await leave();
  await page.locator(".spotlight-select-trigger").click();
  await page.getByRole("dialog",{name:"Choose instance"}).getByRole("button", { name: /Creative/ }).click();
  await page.waitForTimeout(500);
  const start = await page.evaluate(() => performance.now());
  await button.click();
  const calls = await page.evaluate(() => window.pixelTest.calls.filter(c => c.command === "launch_minecraft"));
  assert.equal(calls.length, 1);
  assert.equal(calls[0].args.instanceId, "1");
  assert(calls[0].time - start < 650, "Launch does not wait for the 1000ms reveal");
  assert(await button.isDisabled());
  await page.waitForTimeout(50);
  assert.equal(await clip(), "inset(50%)", "Busy button clears decorative fill");
  assert.deepEqual(errors, []);
  console.log("Pixel Play passed: pointer origins, chunky fill, full/reset states, quick reversal, stable selector, keyboard/reduced motion, animation settings, Light, resize and immediate selected-instance launch.");
} finally { await browser.close(); }
