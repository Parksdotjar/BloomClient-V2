// Browser smoke test against Vite. Native calls are simulated; no account or game files change.
// Set PLAYWRIGHT_MODULE to an installed Playwright entry, and CHROME_PATH if needed.
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
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#f24f54", animations: true, buttonPressDuration: 0 }));
  const instances = ["Fabric", "Vanilla"].map((loader, i) => ({ id: String(i), name: loader, loader, version: "1.21.1", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  const names = ["AmbientEnvironment", "AmbientSounds", "Animatica", "BaguetteLib", "Balm", "BBE"];
  const items = Array.from({ length: 80 }, (_, i) => ({ id: String(i), name: names[i] || `Mod ${String(i).padStart(2, "0")}`, fileName: `mod-${i}.jar`, version: "1.0", size: (i + 1) * 1024, enabled: i < 72 }));
  window.toolbarTest = { calls: [] };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.toolbarTest.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_instance_content") return items.map(item => ({ ...item }));
      if (command === "toggle_instance_content") { items.find(i => i.fileName === args.fileName).enabled = args.enabled; return null; }
      if (command === "search_modrinth_content") return { items: [{ provider: "Modrinth", projectId: "catalog-1", slug: "sample", title: "Catalog Sample", summary: "", author: "Author", downloads: 10, loader: "Fabric", gameVersion: "1.21.1", versionId: "v1", versionNumber: "1.0", fileName: "catalog.jar", fileSize: 1024 }], total: 1, limit: 50, offset: 0 };
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
const shots = process.env.TOOLBAR_SCREENSHOTS;
if (shots) await mkdir(shots, { recursive: true });
const shot = async name => { if (shots) await page.screenshot({ path: `${shots}/${name}.png` }); };
const readout = page.locator(".content-toolbar-readout");
const filterTrigger = page.getByRole("button", { name: /^Filter content:/ });
const drawer = page.locator(".content-toolbar-drawer");
const rows = page.locator(".installed-content-item");
const search = page.locator(".content-search input");
const settle = () => page.waitForTimeout(380);
const waitReadout = text => page.waitForFunction(text => document.querySelector(".content-toolbar-readout")?.textContent === text, text);
try {
  await page.goto(url);
  await page.getByRole("button", { name: "Open Fabric", exact: true }).click();
  await waitReadout("80 installed · 72 enabled");
  await settle();
  await shot("installed");
  const dock = await search.boundingBox();
  await filterTrigger.click();
  await settle();
  assert.equal(await filterTrigger.getAttribute("aria-expanded"), "true");
  assert.equal(await drawer.getAttribute("inert"), null);
  assert.ok(Math.abs((await search.boundingBox()).y - dock.y) < 1, "Filter drawer must not move search dock");
  assert.ok((await rows.first().boundingBox()).y >= (await drawer.boundingBox()).y + (await drawer.boundingBox()).height, "Filters must not cover results");
  await shot("filters");
  if (shots) await page.locator(".content-toolbar").screenshot({ path: `${shots}/toolbar-detail.png` });
  await page.getByRole("button", { name: "Disabled", exact: true }).click();
  await waitReadout("8 of 80 · Disabled");
  assert.equal(await rows.count(), 8);
  await page.getByRole("button", { name: "Size", exact: true }).click();
  assert.match(await rows.first().textContent(), /Mod 79/);
  await page.keyboard.press("Escape");
  await settle();
  assert.equal(await filterTrigger.evaluate(el => el === document.activeElement), true);
  assert.equal(await drawer.getAttribute("inert"), "");
  await search.fill("Mod 78");
  await waitReadout("1 of 80 · Disabled");
  await search.fill("");
  await filterTrigger.click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await waitReadout("80 installed · 72 enabled");
  await page.locator(".content-toolbar-identity h2").click();
  assert.equal(await filterTrigger.getAttribute("aria-expanded"), "true", "Header clicks keep drawer open");
  await search.click();
  assert.equal(await filterTrigger.getAttribute("aria-expanded"), "false", "Outside click closes drawer");
  await rows.first().locator(".toggle").click();
  await waitReadout("80 installed · 71 enabled");
  assert.equal(await page.evaluate(() => window.toolbarTest.calls.filter(c => c.command === "toggle_instance_content").length), 1);
  await page.getByRole("button", { name: "Add Mods", exact: true }).click();
  await page.locator(".catalog-item").first().waitFor();
  assert.equal(await readout.textContent(), "Minecraft 1.21.1 · Fabric");
  assert.equal(await drawer.getAttribute("inert"), "");
  await settle();
  await shot("catalog");
  await search.fill("sample");
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "search_modrinth_content" && c.args.query === "sample" && c.args.category === "mods" && c.args.gameVersion === "1.21.1"));
  await page.getByRole("button", { name: "Back to installed mods" }).click();
  await waitReadout("80 installed · 71 enabled");
  assert.equal(await search.inputValue(), "");
  assert.equal(await page.getByRole("button", { name: "Add Mods", exact: true }).evaluate(el => el === document.activeElement), true, "Mode change preserves action focus");
  for (const theme of ["light", "oled"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await filterTrigger.click(); await settle(); await shot(`${theme}-filters`);
    await page.keyboard.press("Escape"); await settle();
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await filterTrigger.click(); await settle(); await shot("compact");
  const bounds = await drawer.boundingBox();
  const reset = await page.getByRole("button", { name: "Reset", exact: true }).boundingBox();
  assert.ok(reset.y + reset.height <= bounds.y + bounds.height + 1, "Compact controls fit drawer");
  await page.keyboard.press("Escape");
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await filterTrigger.click();
    assert.equal(await drawer.evaluate(el => getComputedStyle(el).transitionDuration), "0s");
    await page.keyboard.press("Escape");
  }
  await page.getByRole("button", { name: "Open Vanilla", exact: true }).click();
  await page.getByRole("button", { name: "Add Mods", exact: true }).click();
  assert.equal(await page.locator(".content-toolbar").getAttribute("data-mode"), "installed", "Rejected catalog request must not enter catalog UI");
  await page.getByRole("tab", { name: "Resource Packs", exact: true }).click();
  await page.getByRole("button", { name: "Add Resource Packs", exact: true }).click();
  await page.locator(".catalog-item").first().waitFor();
  assert.equal(await page.locator(".content-toolbar").getAttribute("data-mode"), "catalog");
  assert.deepEqual(errors, []);
  console.log("Passed: native-backed counts/toggle, live filtering/sort/reset/search, drawer geometry and focus, catalog/back and compatibility gate, both themes, compact layout and all motion overrides. Native calls simulated.");
} finally { await browser.close(); }
