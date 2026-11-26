// Browser verification against Vite. Tauri calls and window visibility are simulated.
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
page.setDefaultTimeout(8000);
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
const errors = [];
page.on("pageerror", error => errors.push(error.stack));
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  window.isTauri = true;
  window.snowTest = { hidden: false, minimized: false, frames: [] };
  Object.defineProperty(document, "hidden", { configurable: true, get: () => window.snowTest.hidden });
  const canvas = CanvasRenderingContext2D.prototype;
  const clearRect = canvas.clearRect;
  const drawImage = canvas.drawImage;
  const rect = canvas.rect;
  canvas.clearRect = function (...args) {
    if (this.canvas.classList.contains("launcher-snowfall")) {
      window.snowTest.frames.push({ time: document.timeline.currentTime, flakes: 0, left: Infinity, right: -Infinity });
    }
    return clearRect.apply(this, args);
  };
  canvas.drawImage = function (...args) {
    if (this.canvas.classList.contains("launcher-snowfall")) {
      const frame = window.snowTest.frames.at(-1);
      if (frame.flakes === 0) [frame.x, frame.y, frame.size] = args.slice(1, 4);
      frame.left = Math.min(frame.left, args[1]);
      frame.right = Math.max(frame.right, args[1]);
      frame.flakes += 1;
    }
    return drawImage.apply(this, args);
  };
  canvas.rect = function (...args) {
    if (this.canvas.classList.contains("launcher-snowfall")) window.snowTest.frames.at(-1).clip = args;
    return rect.apply(this, args);
  };
  let callback = 0;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return ++callback; }, unregisterCallback() {},
    async invoke(command) {
      if (command === "plugin:window|is_minimized") return window.snowTest.minimized;
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "plugin:event|listen") return ++callback;
      if (command === "plugin:app|version") return "1.3.1";
      if (command.startsWith("list_")) return [];
      return null;
    },
  };
});
const canvas = page.locator(".launcher-snowfall");
const toggle = page.getByRole("button", { name: "Snowfall", exact: true });
const countSlider = page.getByRole("slider", { name: "Flake count", exact: true });
const speedSlider = page.getByRole("slider", { name: "Snowfall speed", exact: true });
const sizeSlider = page.getByRole("slider", { name: "Snowflake size", exact: true });
const reduceMotion = page.getByRole("button", { name: "Reduce motion", exact: true });
const settings = async () => {
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Settings", exact: true }).click();
  if (!await toggle.isVisible()) await page.getByRole("button", { name: "Appearance", exact: true }).click();
  await toggle.waitFor();
};
const frames = () => page.evaluate(() => window.snowTest.frames.length);
const waitForFrames = before => page.waitForFunction(count => window.snowTest.frames.length > count + 2, before);
const stayedPaused = async () => {
  const before = await frames();
  await page.waitForTimeout(180);
  assert.equal(await frames(), before);
};
try {
  await page.goto(url);
  await settings();
  assert.equal(await toggle.getAttribute("aria-pressed"), "false");
  assert.equal(await canvas.count(), 0);
  assert.equal(await countSlider.isVisible(), false);
  assert.equal(await page.getByRole("button", { name: "Snowfall settings", exact: true }).count(), 0);
  await stayedPaused();
  const theme = page.getByRole("group", { name: "Theme" });
  await theme.getByRole("button", { name: "Dark", exact: true }).click();
  await toggle.click();
  assert.equal(await countSlider.inputValue(), "18");
  assert.equal(await page.getByRole("button", { name: "Snowfall coverage", exact: true }).count(), 0);
  const order = await toggle.evaluate(element => {
    const appearance = element.closest(".appearance-options");
    return [...appearance.querySelectorAll('[aria-label="Reduce motion"], [aria-label="Snowfall"], .snowfall-settings-panel, .appearance-extra > summary')]
      .map(node => node.getAttribute("aria-label") || node.textContent.trim());
  });
  assert.deepEqual(order, ["Reduce motion", "Snowfall", "Snowfall customization", "More appearance options"]);
  await canvas.waitFor();
  await waitForFrames(0);
  const samples = await page.evaluate(() => window.snowTest.frames);
  assert.ok(samples.every(frame => frame.flakes > 0 && frame.flakes <= 48), "Flakes stay bounded per frame");
  for (let index = 1; index < samples.length; index += 1) {
    assert.ok(samples[index].time - samples[index - 1].time >= 33.2, "Drawing stays at or below 30 fps");
  }
  assert.equal(await canvas.getAttribute("aria-hidden"), "true");
  assert.equal(await canvas.evaluate(element => getComputedStyle(element).animationName), "none");
  const geometry = () => canvas.evaluate(element => {
    const surface = element.getBoundingClientRect();
    const workspace = element.parentElement.querySelector("main").getBoundingClientRect();
    return { surface: surface.toJSON(), workspace: workspace.toJSON(), pixels: element.width * element.height, events: getComputedStyle(element).pointerEvents };
  });
  let sizes = await geometry();
  assert.deepEqual(sizes.surface, sizes.workspace);
  assert.equal(sizes.events, "none");
  const initialFrame = samples.at(-1);
  assert.equal(initialFrame.flakes, 18);
  const originalCanvas = await canvas.elementHandle();
  await countSlider.fill("48");
  await sizeSlider.fill("250");
  await waitForFrames(await frames());
  const fullFrame = await page.evaluate(() => window.snowTest.frames.at(-1));
  assert.equal(fullFrame.flakes, 48);
  assert.ok(Math.abs(fullFrame.size / initialFrame.size - 2.5) < 0.01, "Maximum count and size work together");
  assert.equal(fullFrame.clip, undefined, "Full-workspace snowfall uses no region clip");
  assert.ok(fullFrame.left < sizes.surface.width / 4 && fullFrame.right > sizes.surface.width * 0.75, "Flakes reach both sides of the workspace");
  await countSlider.fill("6");
  await waitForFrames(await frames());
  const enlargedFrame = await page.evaluate(() => window.snowTest.frames.at(-1));
  assert.equal(enlargedFrame.flakes, 6);
  assert.ok(Math.abs(enlargedFrame.size / initialFrame.size - 2.5) < 0.01, "The size slider scales the current flakes live");
  const fallRate = () => page.evaluate(() => {
    const frames = window.snowTest.frames.slice(-3);
    for (let index = 1; index < frames.length; index += 1) {
      const distance = frames[index].y - frames[index - 1].y;
      if (distance > 0) return distance / Math.min(frames[index].time - frames[index - 1].time, 100);
    }
    return 0;
  });
  const normalSpeed = await fallRate();
  await speedSlider.fill("150");
  await waitForFrames(await frames());
  assert.ok(Math.abs(await fallRate() / normalSpeed - 1.5) < 0.03, "The speed slider changes the rate of fall live");
  assert.ok(await canvas.evaluate((element, original) => element === original, originalCanvas), "Controls reuse the drawing surface");
  assert.equal(await countSlider.isVisible(), true);
  await page.setViewportSize({ width: 2600, height: 1500 });
  await page.waitForFunction(() => {
    const surface = document.querySelector(".launcher-snowfall");
    return surface.clientWidth > 2000 && surface.width < surface.clientWidth;
  });
  sizes = await geometry();
  assert.deepEqual(sizes.surface, sizes.workspace);
  assert.ok(sizes.pixels <= 1920 * 1080, "Large windows use the bounded backing surface");
  await page.setViewportSize({ width: 1000, height: 780 });
  await page.getByRole("button", { name: "Delight home", exact: true }).click();
  assert.deepEqual((await geometry()).surface, (await geometry()).workspace);
  await settings();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  await waitForFrames(await frames());
  const flakeInk = () => canvas.evaluate(element => {
    const pixels = element.getContext("2d").getImageData(0, 0, element.width, element.height).data;
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] > 10) return pixels[index];
    }
    return null;
  });
  assert.ok(await flakeInk() > 200, "Dark surfaces get pale snowfall");
  const beforeLight = await frames();
  await theme.getByRole("button", { name: "Light", exact: true }).click();
  await waitForFrames(beforeLight);
  const lightInk = await flakeInk();
  assert.ok(lightInk > 0 && lightInk < 150, "Light surfaces get darker snowfall");

  await page.evaluate(() => { window.snowTest.hidden = true; document.dispatchEvent(new Event("visibilitychange")); });
  await stayedPaused();
  const hiddenFrames = await frames();
  await page.evaluate(() => { window.snowTest.hidden = false; document.dispatchEvent(new Event("visibilitychange")); });
  await waitForFrames(hiddenFrames);
  await page.evaluate(() => { window.snowTest.minimized = true; window.dispatchEvent(new Event("blur")); });
  await page.waitForTimeout(40);
  await stayedPaused();
  const minimizedFrames = await frames();
  await page.evaluate(() => { window.snowTest.minimized = false; window.dispatchEvent(new Event("focus")); });
  await waitForFrames(minimizedFrames);

  await page.emulateMedia({ reducedMotion: "reduce" });
  await canvas.waitFor({ state: "detached" });
  await stayedPaused();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).snowfall), true);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await canvas.waitFor();
  await settings();
  await reduceMotion.click();
  await canvas.waitFor({ state: "detached" });
  await stayedPaused();
  await reduceMotion.click();
  await canvas.waitFor();

  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("bloom-settings"));
    saved.snowfallOptions.coverage = "Right half";
    localStorage.setItem("bloom-settings", JSON.stringify(saved));
  });
  await page.reload();
  await settings();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true", "Snowfall survives a restart");
  assert.equal(await countSlider.inputValue(), "6");
  assert.equal(await speedSlider.inputValue(), "150");
  assert.equal(await sizeSlider.inputValue(), "250");
  assert.ok(await page.evaluate(() => !Object.hasOwn(JSON.parse(localStorage.getItem("bloom-settings")).snowfallOptions, "coverage")));
  await waitForFrames(0);
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("bloom-settings"));
    localStorage.setItem("bloom-settings", JSON.stringify({ ...saved, ultraPerformance: true, animations: true }));
  });
  await page.reload();
  await settings();
  assert.equal(await toggle.getAttribute("aria-pressed"), "true");
  assert.equal(await canvas.count(), 0, "Ultra Performance suppresses snowfall even when animations are enabled");
  await stayedPaused();
  await page.evaluate(() => {
    const saved = JSON.parse(localStorage.getItem("bloom-settings"));
    localStorage.setItem("bloom-settings", JSON.stringify({ ...saved, ultraPerformance: false, animations: true }));
  });
  await page.reload();
  await settings();
  await canvas.waitFor();
  const settingsNav = page.getByRole("navigation", { name: "Settings sections" });
  await settingsNav.getByRole("button", { name: "Background", exact: true }).click();
  await page.getByLabel("Wallpaper file").setInputFiles(fileURLToPath(new URL("../public/delight-logo.png", import.meta.url)));
  await page.locator('.app-shell[data-wallpaper="true"]').waitFor();
  await waitForFrames(await frames());
  assert.deepEqual((await geometry()).surface, (await geometry()).workspace);
  await settingsNav.getByRole("button", { name: "Appearance", exact: true }).click();
  await toggle.click();
  await canvas.waitFor({ state: "detached" });
  assert.equal(await countSlider.isVisible(), false, "Turning off snowfall hides its controls");
  await stayedPaused();
  assert.deepEqual(errors, []);
  console.log("Passed: toggle disclosure and order, saved count/speed/size, full-workspace snowfall, 48 flakes at 250% size, frame caps, visibility, minimize, and motion settings.");
} catch (error) {
  if (errors.length) console.error(errors.join("\n"));
  console.log(await page.evaluate(() => ({
    page: document.querySelector("main")?.dataset.desktopPage,
    snowfall: JSON.parse(localStorage.getItem("bloom-settings"))?.snowfall,
    theme: document.documentElement.dataset.theme,
    animations: document.documentElement.dataset.animations,
    performance: document.documentElement.dataset.performance,
    reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
    canvas: !!document.querySelector(".launcher-snowfall"),
    hidden: document.hidden,
  })));
  throw error;
} finally {
  await browser.close();
}
