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
  window.toolbarTest = { calls: [], failChoices: true, failSearch: false, delaySearch: false, releaseSearch: null };
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
      if (command === "get_catalog_filter_choices") {
        if (window.toolbarTest.failChoices) throw "Offline fixture";
        return { categories: ["optimization", "utility"], loaders: ["fabric", "forge"], versions: ["26.3", "1.21.1"] };
      }
      if (command === "search_modrinth_content") {
        if (window.toolbarTest.delaySearch && !args.offset) { window.toolbarTest.delaySearch = false; await new Promise(resolve => { window.toolbarTest.releaseSearch = resolve; }); }
        if (window.toolbarTest.failSearch) throw "Search offline fixture";
        const loader = args.filters?.loader || "fabric", game = args.gameVersion || "1.21.1";
        const title = args.filters?.category === "optimization" ? "Fast Mod" : args.filters?.category === "utility" ? "Utility Mod" : "Catalog Sample";
        return { items: [{ provider: "Modrinth", projectId: "catalog-1", slug: "sample", title, summary: "", author: "Author", downloads: 10, loader, loaders: [loader], gameVersion: game, gameVersions: [game], versionId: `v-${loader}-${game}`, versionNumber: "1.0", fileName: "catalog.jar", fileSize: 1024 }], total: 101, limit: 50, offset: args.offset };
      }
      if (command === "install_modrinth_content") return { sessionId: "fixture", revision: 1, tasks: [] };
      if (command === "get_modrinth_project_details") throw "Detail fixture offline";
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
const filter = page.locator('.content-filter-trigger[aria-label="Filter mods"]');
const drawer = page.locator(".launcher-filter-menu:not(.filter-choice-menu)");
const search = page.locator(".content-search input");
const settle = () => page.waitForTimeout(380);
const choose = async (name, option) => {
  if (!await drawer.count()) await filter.click();
  const row = drawer.getByRole("menuitem", {name, exact:true});
  await row.click();
  const choices = page.getByRole("menu", {name, exact:true});
  const parent = await drawer.boundingBox(), anchor = await row.boundingBox(), child = await choices.boundingBox();
  assert.ok(Math.abs(child.y - anchor.y) <= 1, "Choices align with the selected section");
  assert.ok(child.x >= parent.x + parent.width || child.x + child.width <= parent.x, "Choices open beside the first menu");
  await choices.getByRole("menuitemradio", {name:option, exact:true}).click();
  assert.equal(await filter.getAttribute("aria-expanded"), "false");
};
const lastSearch = () => page.evaluate(() => window.toolbarTest.calls.filter(c => c.command === "search_modrinth_content" && !c.args.offset).at(-1)?.args);
const results = async title => { await page.locator(".catalog-item").filter({ hasText: title }).waitFor(); };
try {
  await mkdir("logs/catalog-filter-drawer", { recursive: true });
  await page.goto(url);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Instances", exact: true }).click();
  await page.locator(".desktop-instance-link").getByRole("button", { name: "Fabric", exact: true }).click();
  await page.getByRole("button", { name: "Add Mods", exact: true }).click();
  await results("Catalog Sample");
  await settle();
  const dock = await search.boundingBox();
  const before = await page.locator(".catalog-item").first().boundingBox();
  await page.screenshot({ path: "logs/catalog-filter-drawer/closed.png" });
  await filter.click(); await settle();
  await page.getByRole("menuitem", { name: "Retry filter choices" }).waitFor();
  await page.evaluate(() => { window.toolbarTest.failChoices = false; });
  await page.getByRole("menuitem", { name: "Retry filter choices" }).click();
  await page.waitForFunction(() => Array.from(document.querySelectorAll('[role="menuitem"]')).some(el => el.textContent === "Category" && !el.disabled));
  const after = await page.locator(".catalog-item").first().boundingBox();
  assert.equal(after.width, before.width, "Full-width row layout stays unchanged");
  assert.ok(Math.abs((await search.boundingBox()).y - dock.y) < 1, "Drawer must not move the search dock");
  assert.equal(after.y, before.y, "Opening filters leaves results stationary");
  assert.ok(await drawer.evaluate(el => getComputedStyle(el).position === "fixed"));
  const section = drawer.getByRole("menuitem", {name:"Environment",exact:true});
  await section.press("ArrowRight");
  await page.getByRole("menuitemradio", {name:"Any environment"}).waitFor();
  await page.screenshot({ path: "logs/catalog-filter-drawer/open.png" });
  await page.keyboard.press("ArrowLeft");
  assert.ok(await section.evaluate(el => document.activeElement === el));

  await choose("Category", "Optimization"); await results("Fast Mod");
  assert.equal((await lastSearch()).filters.category, "optimization");
  await choose("Environment", "Client-side"); await results("Fast Mod");
  assert.equal((await lastSearch()).filters.environment, "client");
  await choose("Sort results", "Most downloaded"); await results("Fast Mod");
  assert.equal((await lastSearch()).filters.sort, "downloads");
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "search_modrinth_content" && c.args.offset === 50 && c.args.filters?.sort === "downloads" && c.args.filters?.category === "optimization"));
  await choose("Mod loader", "Forge"); await results("Fast Mod");
  assert.equal((await lastSearch()).filters.loader, "forge");
  assert.equal(await page.locator(".catalog-install").first().isDisabled(), true, "Wrong loader cannot install");
  await choose("Mod loader", "Fabric"); await results("Fast Mod");
  await choose("Minecraft version", "26.3"); await results("Fast Mod");
  assert.equal((await lastSearch()).gameVersion, "26.3");
  assert.equal(await page.locator(".catalog-install").first().isDisabled(), true, "Wrong Minecraft version cannot install");
  await page.getByRole("button", { name: "Open details for Fast Mod" }).click();
  const details = await page.evaluate(() => window.toolbarTest.calls.filter(c => c.command === "get_modrinth_project_details").at(-1)?.args);
  assert.equal(details?.versionId, "v-fabric-26.3", "Details must refer to the actual selected file");
  await page.keyboard.press("Escape");
  if (await filter.getAttribute("aria-expanded") !== "true") await filter.click();
  await page.getByRole("menuitem", { name: "Reset filters", exact: true }).click(); await results("Catalog Sample");
  assert.equal((await lastSearch()).filters, undefined, "Reset uses existing default native search");
  assert.equal((await lastSearch()).gameVersion, "1.21.1");
  assert.equal(await filter.getAttribute("data-filtered"), "false");

  await filter.click();
  await page.getByRole("menuitem", { name: "Category", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await filter.getAttribute("aria-expanded"), "true", "First Escape closes only submenu");
  await page.keyboard.press("Escape"); await settle();
  assert.equal(await drawer.count(), 0);
  assert.equal(await filter.evaluate(el => el === document.activeElement), true);
  await page.getByRole("button", { name: "Install Catalog Sample", exact: true }).click();
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "install_modrinth_content" && c.args.instanceId === "0" && c.args.projectId === "catalog-1"));

  // Delayed old filters must not replace the current results.
  await filter.click();
  await page.evaluate(() => { window.toolbarTest.delaySearch = true; });
  await choose("Category", "Optimization");
  await page.waitForFunction(() => typeof window.toolbarTest.releaseSearch === "function");
  await choose("Category", "Utility"); await results("Utility Mod");
  await page.evaluate(() => window.toolbarTest.releaseSearch()); await settle();
  assert.equal(await page.locator(".catalog-item").first().locator("b").textContent(), "Utility Mod");
  // Search failures offer retry without showing results from another filter.
  await page.evaluate(() => { window.toolbarTest.failSearch = true; });
  await choose("Sort results", "Newest");
  await page.getByRole("button", { name: "Retry search", exact: true }).waitFor();
  assert.equal(await page.locator(".catalog-item").count(), 0);
  await page.evaluate(() => { window.toolbarTest.failSearch = false; });
  await page.getByRole("button", { name: "Retry search", exact: true }).click(); await results("Utility Mod");
  if (await filter.getAttribute("aria-expanded") !== "true") await filter.click();
  await page.getByRole("menuitem", { name: "Reset filters", exact: true }).click(); await results("Catalog Sample");

  await filter.click();
  await page.setViewportSize({ width: 900, height: 900 }); await settle();
  for (const theme of ["oled", "light"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    const box = await drawer.boundingBox();
    for (const control of await drawer.locator("button").all()) {
      const rect = await control.boundingBox();
      assert.ok(rect.x >= box.x && rect.x + rect.width <= box.x + box.width + 1 && rect.y + rect.height <= box.y + box.height + 1, "All compact dropdowns must fit");
    }
    await page.screenshot({ path: `logs/catalog-filter-drawer/compact-${theme}.png` });
  }
  await page.keyboard.press("Escape");
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await filter.click();
    assert.equal(await drawer.evaluate(el => getComputedStyle(el).transitionDuration), "0s");
    await page.keyboard.press("Escape");
  }
  await filter.click();
  await page.getByRole("button", { name: "Back to installed mods" }).click();
  assert.equal(await drawer.count(), 0, "Back closes catalog filters without opening installed filters");
  await page.getByRole("button", { name: /^Filter content:/ }).click();
  await page.getByRole("menuitem", { name: "Show", exact: true }).click();
  await page.getByRole("menuitemradio", { name: "Disabled", exact: true }).click();
  assert.equal(await page.locator(".installed-content-item").count(), 8, "Installed filters retain existing behavior");
  assert.deepEqual(errors, []);
  console.log("Passed: cascading filter menus, stationary search/full-width rows, all real native filter arguments, metadata retry, warm-cache isolation, stale response protection, search retry, compatibility/install/details, reset, submenu Escape/focus, compact Light/OLED and motion overrides. Native calls simulated.");
} finally { await browser.close(); }
