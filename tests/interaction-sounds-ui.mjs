// Run against Vite with PLAYWRIGHT_MODULE / CHROME_PATH when needed.
// Uses the real React app, browser AudioContext and DOM input. Only Tauri calls are fixtures.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.stack || error.message));
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
const origin = new URL(url).origin;
await page.route("**/*", route => {
  const target = route.request().url();
  return target.startsWith(`${origin}/`) || target.startsWith("data:") ? route.continue() : route.abort();
});

await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  // Seed once: reload must prove real settings persistence rather than reseeding it.
  if (!localStorage.getItem("interaction-sounds-test-seeded")) {
    localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#f24f54", animations: true, buttonPressDuration: 0 }));
    localStorage.setItem("interaction-sounds-test-seeded", "yes");
  }
  const state = window.soundTest = { starts: [], contexts: [], live: new Set(), calls: [], wheels: [], scrolls: [], holdExport: false, failExport: false, releaseExport: null, holdToggle: false, failToggle: false, releaseToggle: null };
  document.addEventListener("wheel", event => { state.wheels.push({ at: performance.now(), target: event.target.className, top: event.target.scrollTop, delta: event.deltaY, trusted: event.isTrusted }); }, { capture: true, passive: true });
  document.addEventListener("scroll", event => { state.scrolls.push({ at: performance.now(), target: event.target.className, top: event.target.scrollTop }); }, { capture: true, passive: true });
  const NativeContext = window.AudioContext;
  if (NativeContext) {
    window.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); state.contexts.push(this); }
    };
    const originalStart = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...args) {
      const result = originalStart.apply(this, args);
      state.starts.push({ at: performance.now(), duration: this.buffer?.duration ?? 0, contextTime: this.context.currentTime });
      state.live.add(this);
      this.addEventListener("ended", () => state.live.delete(this), { once: true });
      return result;
    };
  }
  const art = (color, letter) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/><text x="50" y="68" text-anchor="middle" fill="white" font-family="sans-serif" font-size="48" font-weight="bold">${letter}</text></svg>`);
  const instances = ["Meadow", "Vanilla"].map((name, i) => ({ id: String(i), name, loader: i ? "Vanilla" : "Fabric", version: "1.21.1", directory: `C:/Bloom/instances/${name}`, java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true, icon: art(i ? "#a18350" : "#55795e", name[0]) }));
  const items = Array.from({ length: 80 }, (_, i) => ({ name: `Mod ${i}`, fileName: `mod-${i}.jar`, version: "1", enabled: true, size: 1024, loader: "Fabric" }));
  let callback = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return callback++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      state.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_instance_content") return items.map(item => ({ ...item }));
      if (command === "toggle_instance_content") {
        if (state.holdToggle) await new Promise(resolve => { state.releaseToggle = resolve; });
        if (state.failToggle) throw "Toggle failed in test";
        items.find(item => item.fileName === args.fileName).enabled = args.enabled;
        return null;
      }
      if (command === "export_instance") {
        if (state.holdExport) await new Promise(resolve => { state.releaseExport = resolve; });
        if (state.failExport) throw "Export failed in test";
        return "C:/Bloom/exports/Meadow.zip";
      }
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "get_minecraft_releases") return [{ id: "1.21.1", type: "release" }];
      if (["list_instance_folders", "list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_managed_java_runtimes"].includes(command)) return [];
      if (command === "get_cosmetics_preferences") return { enabled: true };
      if (command === "get_client_cache_status") return { directory: "C:/Bloom/cache", capacityBytes: 2147483648, usedBytes: 0, itemCount: 0 };
      if (command === "plugin:event|listen") return callback++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});

const count = () => page.evaluate(() => window.soundTest.starts.length);
const settle = () => page.waitForTimeout(280);
const soundSettings = page.locator(".sound-settings");
const master = page.getByRole("button", { name: "Interface sounds", exact: true });
const advanced = page.getByRole("button", { name: "Advanced sound settings", exact: true });
const categoryLabels = { buttons: "Button sounds", toggles: "Toggle sounds", scroll: "Scroll sounds", success: "Confirmation sounds" };
const nav = label => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: label, exact: true });
const trayToggle = page.locator(".setting-row").filter({ has: page.getByText("Minimize to System Tray", { exact: true }) }).locator(".toggle");
const saved = () => page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).interactionSounds);
const shot = async name => {
  if (!process.env.SOUND_SCREENSHOTS) return;
  await mkdir(process.env.SOUND_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: `${process.env.SOUND_SCREENSHOTS}/${name}.png` });
};
const setToggle = async (control, enabled) => {
  if ((await control.getAttribute("aria-pressed")) !== String(enabled)) await control.click();
  assert.equal(await control.getAttribute("aria-pressed"), String(enabled));
};
const openSettings = async () => { await nav("Settings").click(); await soundSettings.waitFor(); await settle(); };
const openAdvanced = async () => {
  if (await advanced.getAttribute("aria-expanded") !== "true") await advanced.click();
  assert.equal(await advanced.getAttribute("aria-expanded"), "true");
};
const setCategories = async values => {
  await openAdvanced();
  for (const [category, enabled] of Object.entries(values)) await setToggle(page.getByRole("button", { name: categoryLabels[category], exact: true }), enabled);
  await settle();
};
const expectSilent = async (action, label) => {
  await settle();
  const before = await count();
  await action(); await settle();
  assert.equal(await count(), before, label);
};
const expectSound = async (action, label) => {
  await settle();
  const before = await count();
  await action();
  await page.waitForFunction(previous => window.soundTest.starts.length > previous, before);
  await settle();
  assert.ok(await count() > before, label);
  return (await count()) - before;
};
const exportInstance = async () => {
  await nav("Instances").click();
  await page.getByRole("button", { name: "Actions for Meadow", exact: true }).click();
  await page.getByRole("button", { name: "Export ZIP", exact: true }).click();
};

try {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  await openSettings();
  assert.equal(await master.getAttribute("aria-pressed"), "false", "Interface sounds start off");
  assert.equal(await page.evaluate(() => window.soundTest.contexts.length), 0, "Silent startup creates no audio device/context");
  await expectSilent(() => trayToggle.click(), "Normal controls stay silent by default");
  await expectSilent(openAdvanced, "Opening sound settings is silent");
  for (const [category, enabled] of Object.entries({ buttons: true, toggles: true, scroll: false, success: true })) {
    assert.equal(await page.getByRole("button", { name: categoryLabels[category], exact: true }).getAttribute("aria-pressed"), String(enabled));
  }
  assert.equal(await page.getByRole("slider", { name: "Sound volume", exact: true }).inputValue(), "35");
  assert.equal(await page.getByRole("slider", { name: "Sound depth", exact: true }).inputValue(), "60");
  assert.equal(await page.getByRole("slider", { name: "Sound echo", exact: true }).inputValue(), "20");
  await setCategories({ buttons: false, toggles: false, scroll: false, success: false });
  for (const label of ["Preview buttons", "Preview toggles", "Preview scrolling", "Preview confirmations"]) {
    await expectSound(() => page.getByRole("button", { name: label, exact: true }).click(), `${label} works explicitly while master and category are off`);
  }
  assert.equal(await page.evaluate(() => window.soundTest.contexts.length), 1, "All previews reuse one audio context");
  await expectSilent(() => setToggle(master, true), "Enabling sounds does not make the preference control click twice");
  await expectSilent(() => trayToggle.click(), "Disabled toggle category stays silent with master on");

  await setCategories({ buttons: true, toggles: false });
  await expectSilent(() => trayToggle.click(), "Toggles do not fall through to button sounds");
  const pointerNotes = await expectSound(() => nav("Instances").click(), "Pointer button activation plays a sound");
  await expectSound(async () => { await nav("Settings").focus(); await page.keyboard.press("Enter"); }, "Keyboard button activation plays a sound");
  await soundSettings.waitFor();
  const keyboardNotes = await expectSound(async () => { await nav("Instances").focus(); await page.keyboard.press("Space"); }, "Space activation plays a sound");
  assert.equal(keyboardNotes, pointerNotes, "Keyboard activation does not duplicate the button cue");
  await openSettings();
  await setCategories({ buttons: false, toggles: true });
  await expectSound(() => trayToggle.click(), "Toggle category works independently from buttons");
  await expectSilent(() => advanced.click(), "Excluded sound preference controls never play delegated clicks");
  await openAdvanced();

  // A mod toggle waits for its native save and then moves/sounds together.
  await nav("Instances").click();
  await page.getByLabel("Instance library", { exact: true }).getByRole("button", { name: "Open Meadow", exact: true }).click();
  const modToggle = page.locator(".installed-content-item .toggle").first();
  await modToggle.waitFor();
  await page.evaluate(() => { window.soundTest.holdToggle = true; });
  await expectSilent(() => modToggle.click(), "Pending native toggle stays silent and does not fake its landing");
  assert.equal(await modToggle.getAttribute("aria-pressed"), "true");
  await expectSound(() => page.evaluate(() => window.soundTest.releaseToggle()), "Confirmed mod toggle plays its movement sound");
  assert.equal(await modToggle.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => { window.soundTest.holdToggle = false; window.soundTest.failToggle = true; });
  await expectSilent(() => modToggle.click(), "Failed native toggle does not play a success landing");
  assert.equal(await modToggle.getAttribute("aria-pressed"), "false");
  await page.evaluate(() => { window.soundTest.failToggle = false; });
  await openSettings();

  // Confirmations follow a successful native result, never the start of a request.
  await setCategories({ buttons: false, toggles: false, scroll: false, success: true });
  await page.evaluate(() => { window.soundTest.holdExport = true; });
  await expectSilent(exportInstance, "Pending native export is not announced as success");
  await page.waitForFunction(() => typeof window.soundTest.releaseExport === "function");
  await expectSound(() => page.evaluate(() => window.soundTest.releaseExport()), "Successful native completion plays confirmation");
  await page.evaluate(() => { window.soundTest.holdExport = false; window.soundTest.failExport = true; });
  await expectSilent(exportInstance, "Failed native export does not play a success cue");
  await page.evaluate(() => { window.soundTest.failExport = false; });
  await openSettings();
  await setCategories({ success: false });
  await expectSilent(exportInstance, "Confirmation category can be disabled independently");

  await openSettings();
  await setCategories({ buttons: false, toggles: false, scroll: true, success: false });
  const scroller = page.locator("main.content");
  assert.ok(await scroller.evaluate(element => element.scrollHeight > element.clientHeight + 500), "Settings is a real scrollable workspace");
  await scroller.evaluate(element => { element.scrollTop = 0; }); await settle();
  const bounds = await scroller.boundingBox();
  await page.mouse.move(bounds.x + bounds.width - 25, bounds.y + bounds.height / 2);
  const scrollBefore = await scroller.evaluate(element => element.scrollTop);
  await expectSound(() => page.mouse.wheel(0, 450), "Wheel movement in the actual settings pane plays a scroll cue");
  assert.ok(await scroller.evaluate(element => element.scrollTop) > scrollBefore);
  await expectSilent(() => scroller.evaluate(element => { element.scrollTop += 100; }), "Programmatic scrolling remains silent");
  await scroller.evaluate(element => { element.scrollTop = element.scrollHeight; }); await settle();
  await expectSilent(() => page.mouse.wheel(0, 300), "A wheel at the bottom boundary remains silent");
  await scroller.evaluate(element => { element.scrollTop = 0; }); await settle();
  await expectSilent(() => page.mouse.wheel(0, -300), "A wheel at the top boundary remains silent");
  await expectSilent(async () => { await page.keyboard.down("Control"); await page.mouse.wheel(0, 100); await page.keyboard.up("Control"); }, "Ctrl-wheel/pinch does not play a scroll cue");

  const wheelRhythm = async delta => {
    await scroller.evaluate(element => { element.scrollTop = 0; }); await settle();
    const rect = await scroller.boundingBox();
    await page.mouse.move(rect.x + rect.width - 25, rect.y + rect.height / 2);
    const before = await count();
    for (let step = 0; step < 40; step++) { await page.mouse.wheel(0, delta); await page.waitForTimeout(20); }
    await settle();
    return page.evaluate(before => ({ times: window.soundTest.starts.slice(before).map(item => item.at), distance: document.querySelector("main.content").scrollTop }), before);
  };
  const slowRhythm = await wheelRhythm(3);
  const fastRhythm = await wheelRhythm(36);
  assert.ok(slowRhythm.times.length >= 2, "Small wheel deltas accumulate into audible detents");
  assert.ok(fastRhythm.times.length > slowRhythm.times.length * 2, "Fast actual scrolling produces more ticks than slow movement at the same input frequency");
  const averageInterval = times => (times.at(-1) - times[0]) / (times.length - 1);
  assert.ok(averageInterval(fastRhythm.times) < averageInterval(slowRhythm.times), "Fast scrolling has a tighter tick rhythm");
  assert.ok(fastRhythm.distance > slowRhythm.distance * 5, "Cadence test moves the real content at different speeds");
  await expectSilent(() => page.waitForTimeout(400), "Ticks stop after scrolling settles; no queued trailing rhythm");
  console.log("Actual wheel cadence:", { slowTicks: slowRhythm.times.length, fastTicks: fastRhythm.times.length, slowInterval: Math.round(averageInterval(slowRhythm.times)), fastInterval: Math.round(averageInterval(fastRhythm.times)) });

  await openSettings();
  await openAdvanced();
  // Tune through native keyboard range input, then verify stored values and reload.
  const tuned = {};
  for (const [key, label] of [["volume", "Sound volume"], ["depth", "Sound depth"], ["echo", "Sound echo"]]) {
    const slider = page.getByRole("slider", { name: label, exact: true });
    await slider.focus(); await slider.press("End"); await slider.press("ArrowLeft");
    tuned[key] = Number(await slider.inputValue());
  }
  await setCategories({ buttons: false, toggles: true, scroll: true, success: false });
  const expected = { enabled: true, ...tuned, categories: { buttons: false, toggles: true, scroll: true, success: false } };
  await page.waitForFunction(expected => {
    const value = JSON.parse(localStorage.getItem("bloom-settings")).interactionSounds;
    return value && ["enabled", "volume", "depth", "echo"].every(key => value[key] === expected[key])
      && Object.keys(expected.categories).every(key => value.categories[key] === expected.categories[key]);
  }, expected);
  assert.deepEqual(await saved(), expected);
  await page.reload({ waitUntil: "domcontentloaded" }); await openSettings(); await openAdvanced();
  assert.deepEqual(await saved(), expected, "Sound preferences survive a real page reload");
  assert.equal(await master.getAttribute("aria-pressed"), "true");
  for (const [key, label] of [["volume", "Sound volume"], ["depth", "Sound depth"], ["echo", "Sound echo"]]) {
    assert.equal(Number(await page.getByRole("slider", { name: label, exact: true }).inputValue()), tuned[key]);
  }
  await expectSound(() => trayToggle.click(), "Persisted toggle preference works after reload");
  await expectSilent(async () => {
    const volume = page.getByRole("slider", { name: "Sound volume", exact: true });
    await volume.focus(); await volume.press("Home"); await settle();
    await trayToggle.click();
  }, "Zero volume stops automatic sound playback");
  const volume = page.getByRole("slider", { name: "Sound volume", exact: true });
  await volume.focus(); await volume.press("End");

  // Turning the master off stops current playback, not only future gestures.
  const preview = page.getByRole("button", { name: "Preview confirmations", exact: true });
  const beforePreview = await count();
  await preview.click();
  await page.waitForFunction(previous => window.soundTest.starts.length > previous, beforePreview);
  await setToggle(master, false);
  await page.waitForFunction(() => window.soundTest.live.size === 0 || window.soundTest.contexts.every(context => context.state !== "running"));
  await expectSilent(() => trayToggle.click(), "Master off suppresses subsequent gestures");

  await page.setViewportSize({ width: 1440, height: 1000 });
  await soundSettings.scrollIntoViewIfNeeded(); await shot("sound-settings-expanded");
  for (const theme of ["oled", "light"]) {
    await page.evaluate(theme => {
      const settings = JSON.parse(localStorage.getItem("bloom-settings"));
      localStorage.setItem("bloom-settings", JSON.stringify({ ...settings, theme }));
    }, theme);
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.setViewportSize({ width: 900, height: 680 });
    await openSettings(); await openAdvanced(); await soundSettings.scrollIntoViewIfNeeded(); await settle();
    const overflow = await soundSettings.evaluate(element => ({ client: element.clientWidth, scroll: element.scrollWidth }));
    assert.ok(overflow.scroll <= overflow.client + 1, `${theme} sound settings fit the narrow window`);
    for (const label of ["Interface sounds", "Advanced sound settings", ...Object.values(categoryLabels)]) {
      assert.equal(await page.getByRole("button", { name: label, exact: true }).isEnabled(), true);
    }
    await shot(`sound-settings-${theme}-compact`);
  }
  await trayToggle.scrollIntoViewIfNeeded(); await settle();
  const initialToggleState = await trayToggle.getAttribute("aria-pressed");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await trayToggle.click();
  await page.waitForFunction(() => {
    const row = [...document.querySelectorAll(".setting-row")].find(element => element.querySelector("b")?.textContent === "Minimize to System Tray");
    const thumb = row?.querySelector(".toggle > span");
    return thumb && parseFloat(getComputedStyle(thumb).scale) > 1.03;
  }, undefined, { polling: "raf", timeout: 1000 });
  await trayToggle.click(); await settle();
  assert.equal(await trayToggle.getAttribute("aria-pressed"), initialToggleState, "Rapid reversal preserves the authoritative toggle state");
  const settledThumb = await trayToggle.locator("span").evaluate(element => ({ scale: getComputedStyle(element).scale, x: parseFloat(getComputedStyle(element).translate) }));
  assert.ok(settledThumb.scale === "none" || Math.abs(parseFloat(settledThumb.scale) - 1) < .001, "Thumb settles round after reversal");
  assert.equal(settledThumb.x, initialToggleState === "true" ? 20 : 0, "Thumb lands at the correct state endpoint");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await trayToggle.scrollIntoViewIfNeeded(); await trayToggle.click();
  assert.equal(await trayToggle.locator("span").evaluate(element => element.getAnimations().length), 0, "Reduced motion disables toggle thumb animation");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  for (const mode of ["off", "ultra"]) {
    const motionToggle = page.locator(".setting-row").filter({ has: page.getByText(mode === "off" ? "Show Animations" : "Ultra Performance Mode", { exact: true }) }).locator(".toggle");
    await setToggle(motionToggle, mode === "ultra");
    await trayToggle.scrollIntoViewIfNeeded(); await settle();
    await trayToggle.click();
    assert.equal(await trayToggle.locator("span").evaluate(element => element.getAnimations().length), 0, `${mode} disables toggle thumb animation`);
  }
  assert.deepEqual(errors, []);
  console.log("Interaction sounds passed: silent/lazy defaults, explicit previews, category isolation, pointer/keyboard activation, real native success/error timing, actual wheel versus boundary/programmatic scroll, persistent tuning, mute, compact themes and motion overrides. Tauri calls are fixtures; browser Web Audio is real.");
} catch (error) {
  await shot("sound-settings-failure");
  console.error(errors);
  console.error(await page.evaluate(() => ({ started: window.soundTest?.starts.length, contexts: window.soundTest?.contexts.map(context => context.state), live: window.soundTest?.live.size, wheels: window.soundTest?.wheels.slice(-4), scrolls: window.soundTest?.scrolls.slice(-12), focused: document.hasFocus(), sounds: JSON.parse(localStorage.getItem("bloom-settings")).interactionSounds })));
  throw error;
} finally {
  await browser.close();
}
