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
        const item = { provider: "Modrinth", projectId: "catalog-1", slug: "sample", title, summary: "", author: "Author", downloads: 10, loader, loaders: [loader], gameVersion: game, gameVersions: [game], versionId: `v-${loader}-${game}`, versionNumber: "1.0", fileName: "catalog.jar", fileSize: 1024 };
        return { items: [item, { ...item, projectId: "catalog-2", slug: "second-mod", title: "Second Mod", fileName: "second.jar" }], total: 650, limit: 50, offset: args.offset };
      }
      if (command === "install_modrinth_content") return { sessionId: "fixture", revision: 1, tasks: [] };
      if (command === "get_modrinth_project_details") throw "Detail fixture offline";
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (["list_instance_folders", "list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
const sidebar = page.getByRole("complementary", { name: "Modrinth filters" });
const toolbar = page.locator(".content-toolbar");
const search = page.locator(".content-search input");
const settle = () => page.waitForTimeout(380);
const choose = async (name, option) => {
  await sidebar.getByRole("button", { name, exact: true }).click();
  const choices = page.getByRole("dialog", { name, exact: true });
  await choices.getByRole("button", { name: option, exact: true }).click();
  assert.ok(await sidebar.isVisible(), "Selecting a dropdown leaves the sidebar visible");
};
const measureTransition = async button => button.evaluate(async trigger => {
  const manager = trigger.closest("[data-mods-content]");
  const rail = manager.querySelector(".catalog-filter-rail");
  const drawer = rail.querySelector(".catalog-filter-sidebar");
  const installed = manager.querySelector('[data-mods-layer="installed"]');
  const catalog = manager.querySelector('[data-mods-layer="catalog"]');
  const copy = trigger.querySelector(".content-toolbar-action-copy");
  const labels = [...copy.children];
  const searchHints = [...manager.querySelectorAll(".content-search-hint .content-mode-copy")];
  const readouts = [...manager.querySelectorAll(".instance-content-context .content-mode-copy")];
  trigger.focus();
  trigger.click();
  await new Promise(requestAnimationFrame);
  const listTransitions = [installed, catalog].flatMap(layer =>
    layer.getAnimations().filter(animation => ["translate", "opacity"].includes(animation.transitionProperty)));
  const railTransitions = rail.getAnimations();
  const slide = listTransitions.find(animation => animation.transitionProperty === "translate");
  const fade = railTransitions.find(animation => animation.transitionProperty === "opacity");
  const drawerSlide = drawer.getAnimations().find(animation => animation.transitionProperty === "translate");
  if (!slide || !fade || !drawerSlide) throw new Error("Expected the drawer and lists to slide together");
  const slideDuration = slide.effect.getTiming().duration;
  const { duration: fadeDuration, delay: fadeDelay } = fade.effect.getTiming();
  const drawerTiming = drawerSlide.effect.getTiming();
  const actionTransitions = [trigger, copy, ...labels, ...searchHints, ...readouts].flatMap(part => part.getAnimations());
  const transitions = [...listTransitions, ...railTransitions, drawerSlide, ...actionTransitions];
  const read = layer => {
    const [row, nextRow] = layer.querySelectorAll(".instance-list-row");
    const { x, y, width, height } = (row ?? layer).getBoundingClientRect();
    const pitch = nextRow && nextRow.getBoundingClientRect().y - y;
    return { x, y, width, height, pitch, opacity: Number(getComputedStyle(layer).opacity), row: row?.textContent };
  };
  const sample = time => {
    for (const animation of transitions) {
      animation.pause();
      animation.currentTime = time;
    }
    const { x, right } = drawer.getBoundingClientRect();
    const buttonBounds = trigger.getBoundingClientRect();
    const actionStyle = getComputedStyle(trigger);
    const action = { width: buttonBounds.width, right: buttonBounds.right, border: actionStyle.borderTopColor,
      scale: Number(actionStyle.scale), labels: labels.map(label => Number(getComputedStyle(label).opacity)) };
    const hints = searchHints.map(hint => Number(getComputedStyle(hint).opacity));
    const context = readouts.map(readout => Number(getComputedStyle(readout).opacity));
    return { installed: read(installed), catalog: read(catalog), drawer: { x, right }, railOpacity: Number(getComputedStyle(rail).opacity), action, hints, context };
  };
  const samples = [sample(0), sample(slideDuration / 2), sample(slideDuration)];
  transitions.forEach(animation => animation.finish());
  return { samples, slideDuration, fadeDelay, fadeDuration, drawerDelay: drawerTiming.delay, drawerDuration: drawerTiming.duration,
    railLeft: rail.getBoundingClientRect().left, clipping: getComputedStyle(rail).overflowX,
    sameAction: trigger === manager.querySelector(".content-toolbar-action"), actionFocused: trigger === document.activeElement };
});
const checkSlide = ({ samples: [start, middle, end], slideDuration, fadeDelay, fadeDuration, drawerDelay, drawerDuration, railLeft, clipping, sameAction, actionFocused }, direction, checkCrossfade = true) => {
  for (const key of ["installed", "catalog"]) {
    assert.ok((middle[key].x - start[key].x) * direction > 0 && (end[key].x - middle[key].x) * direction > 0, `${key} slides horizontally`);
    for (const property of ["y", "width", "height"]) {
      assert.equal(start[key][property], middle[key][property], `${key} keeps its ${property} through the slide`);
      assert.equal(middle[key][property], end[key][property], `${key} keeps its ${property} at the end`);
    }
  }
  assert.equal(fadeDelay, 0, "The drawer starts fading with the lists");
  assert.equal(drawerDelay, 0, "The drawer starts sliding with the lists");
  assert.equal(fadeDuration, slideDuration, "The drawer fades for the duration of the list motion");
  assert.equal(drawerDuration, slideDuration, "The drawer and lists have the same travel time");
  assert.equal(clipping, "clip", "Drawer travel stays inside the sidebar viewport");
  const open = direction > 0 ? end : start;
  const closed = direction > 0 ? start : end;
  assert.equal(open.railOpacity, 1);
  assert.equal(closed.railOpacity, 0);
  assert.ok(middle.railOpacity > 0 && middle.railOpacity < 1, "The drawer fades along its path");
  assert.equal(open.drawer.x, railLeft, "The drawer settles at the viewport edge");
  assert.ok(closed.drawer.right <= railLeft, "The closed drawer is fully concealed");
  const gap = open.catalog.x - open.drawer.right;
  assert.ok(gap > 0, "The drawer leaves a gap beside the list");
  for (const position of [start, middle, end]) {
    assert.ok(Math.abs(position.catalog.x - position.drawer.right - gap) < 0.1, "The drawer keeps its gap to the list throughout the slide");
  }
  assert.ok(sameAction && actionFocused, "Add and Back share one button and preserve focus");
  for (const property of ["width", "scale"]) {
    assert.ok((middle.action[property] - start.action[property]) * direction > 0 && (end.action[property] - middle.action[property]) * direction > 0, `The button smoothly changes ${property}`);
  }
  assert.ok(Math.abs(middle.action.right - start.action.right) < 0.1 && Math.abs(end.action.right - start.action.right) < 0.1, "The button keeps its right anchor");
  assert.notEqual(middle.action.border, start.action.border, "The border starts changing color");
  assert.notEqual(middle.action.border, end.action.border, "The border reaches its final color gradually");
  assert.deepEqual(open.action.labels, [0, 1]);
  assert.deepEqual(closed.action.labels, [1, 0]);
  assert.ok(middle.action.labels.every(opacity => opacity > 0 && opacity < 1), "The button labels crossfade");
  for (const key of ["hints", "context"]) {
    assert.deepEqual(open[key], [0, 1]);
    assert.deepEqual(closed[key], [1, 0]);
    assert.ok(middle[key].every(opacity => opacity > 0 && opacity < 1), `${key} crossfade in place`);
  }
  if (checkCrossfade) {
    assert.equal(middle.installed.height, middle.catalog.height, "Both row styles have the same height");
    assert.equal(middle.installed.pitch, middle.catalog.pitch, "Both lists have matching row spacing");
    assert.equal(middle.installed.x, middle.catalog.x, "The two lists slide together");
    assert.equal(middle.installed.y, middle.catalog.y, "The rows line up vertically");
    assert.ok(middle.installed.opacity > 0 && middle.installed.opacity < 1 && middle.catalog.opacity > 0 && middle.catalog.opacity < 1, "The two lists overlap in a real crossfade");
    assert.ok((middle.catalog.opacity - start.catalog.opacity) * direction > 0 && (middle.installed.opacity - start.installed.opacity) * direction < 0);
  }
};
const lastSearch = () => page.evaluate(() => window.toolbarTest.calls.filter(c => c.command === "search_modrinth_content" && !c.args.offset).at(-1)?.args);
const results = async title => { await page.locator(".catalog-item").filter({ hasText: title }).waitFor(); };
try {
  await mkdir("logs/catalog-filter-sidebar", { recursive: true });
  await page.goto(url);
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Instances", exact: true }).click();
  await page.locator(".desktop-instance-link").getByRole("button", { name: "Fabric", exact: true }).click();
  const addMods = page.getByRole("button", { name: "Add Mods", exact: true });
  await page.locator(".installed-content-item").first().waitFor();
  await settle();
  assert.equal(await toolbar.getByRole("button", { name: /filter/i }).count(), 0);
  const dock = await search.boundingBox();
  assert.equal(await sidebar.count(), 0, "The installed view keeps the catalog filters out of the tab order");
  await page.evaluate(() => { window.toolbarTest.delaySearch = true; });
  const coldEntry = await measureTransition(addMods);
  checkSlide(coldEntry, 1, false);
  assert.ok(coldEntry.samples[1].installed.row?.includes("AmbientEnvironment"), "Cold entry keeps outgoing installed rows visible as they slide");
  assert.equal(coldEntry.samples[2].installed.opacity, 1, "The installed rows wait for catalog results");
  await page.waitForFunction(() => typeof window.toolbarTest.releaseSearch === "function");
  assert.equal(await page.getByRole("button", { name: "Page 2", exact: true }).count(), 1, "Initial catalog loading keeps the previous page range");
  await page.evaluate(() => { window.toolbarTest.releaseSearch(); window.toolbarTest.releaseSearch = null; });
  await page.getByRole("button", { name: "Page 13", exact: true }).waitFor();
  const pagerMotion = await page.locator(".instance-pagination").evaluate(async pager => {
    const outgoing = pager.querySelector(".instance-pagination-outgoing");
    const incoming = outgoing?.previousElementSibling;
    if (!outgoing || !incoming) return null;
    const times = [incoming, outgoing].map(layer => {
      const animation = layer.getAnimations()[0];
      animation.pause();
      animation.currentTime = animation.effect.getTiming().duration / 2;
      return { opacity: Number(getComputedStyle(layer).opacity), translate: getComputedStyle(layer).translate };
    });
    [incoming, outgoing].flatMap(layer => layer.getAnimations()).forEach(animation => animation.finish());
    return { times, inert: outgoing.inert, hasEllipsis: incoming.textContent.includes("…") };
  });
  assert.ok(pagerMotion?.times.every(({ opacity, translate }) => opacity > 0 && opacity < 1 && translate !== "none"), "The page ranges slide and crossfade");
  assert.ok(pagerMotion.inert && pagerMotion.hasEllipsis, "Only the new page range is interactive");
  await page.waitForFunction(() => {
    const installed = document.querySelector('[data-mods-layer="installed"]');
    const catalog = document.querySelector('[data-mods-layer="catalog"]');
    return catalog?.querySelector(".catalog-item") && [installed, catalog].every(layer => {
      const opacity = Number(getComputedStyle(layer).opacity);
      return opacity > 0 && opacity < 1;
    });
  }, undefined, { timeout: 3000 });
  await results("Catalog Sample");
  await settle();
  assert.equal(await toolbar.locator(".content-filter-trigger").count(), 0, "Add Mods has no Filter button");
  await sidebar.getByRole("button", { name: "Retry filter choices" }).waitFor();
  await page.evaluate(() => { window.toolbarTest.failChoices = false; });
  await sidebar.getByRole("button", { name: "Retry filter choices" }).click();
  await sidebar.locator('button[aria-label="Category"]:enabled').waitFor();
  assert.deepEqual(await sidebar.locator(".catalog-filter-field > span").allTextContents(),
    ["Minecraft version", "Environment", "Category", "Mod loader", "Sort results"]);
  const after = await page.locator(".catalog-item").first().boundingBox();
  const rail = await sidebar.boundingBox();
  assert.ok(after.x >= rail.x + rail.width, "Results sit beside the sidebar");
  const dropdown = await sidebar.getByRole("button", { name: "Minecraft version", exact: true }).boundingBox();
  assert.equal(dropdown.x - rail.x, rail.x + rail.width - dropdown.x - dropdown.width, "The dropdown fits the rail with equal side padding");
  assert.ok(Math.abs((await search.boundingBox()).y - dock.y) < 1, "Opening Add Mods keeps search stationary");
  await page.screenshot({ path: "logs/catalog-filter-sidebar/open.png" });
  const section = sidebar.getByRole("button", { name: "Environment", exact: true });
  await section.press("ArrowDown");
  await page.getByRole("dialog", { name: "Environment" }).getByRole("button", { name: "Any environment" }).waitFor();
  await page.keyboard.press("Escape");
  assert.ok(await section.evaluate(el => document.activeElement === el));

  await page.getByRole("button", { name: "Page 2", exact: true }).click();
  await page.locator('[aria-label="Page 2"][aria-current="page"]:not([inert] *)').waitFor();
  await choose("Category", "Optimization"); await results("Fast Mod");
  await page.locator('[aria-label="Page 1"][aria-current="page"]:not([inert] *)').waitFor();
  assert.equal((await lastSearch()).filters.category, "optimization");
  assert.equal(await sidebar.getByRole("button", { name: "Category", exact: true }).textContent(), "Optimization");
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
  await sidebar.getByRole("button", { name: "Reset filters", exact: true }).click(); await results("Catalog Sample");
  assert.equal((await lastSearch()).filters, undefined, "Reset uses existing default native search");
  assert.equal((await lastSearch()).gameVersion, "1.21.1");
  assert.ok(await sidebar.getByRole("button", { name: "Reset filters", exact: true }).isDisabled());

  await sidebar.getByRole("button", { name: "Category", exact: true }).press("ArrowDown");
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog", { name: "Category" }).count(), 0);
  await page.keyboard.press("Escape");
  assert.ok(await sidebar.isVisible(), "Escape closes the dropdown and leaves the sidebar visible");
  await page.getByRole("button", { name: "Install Catalog Sample", exact: true }).click();
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "install_modrinth_content" && c.args.instanceId === "0" && c.args.projectId === "catalog-1"));

  // Delayed old filters must not replace the current results.
  await page.evaluate(() => { window.toolbarTest.delaySearch = true; });
  await choose("Category", "Optimization");
  await page.waitForFunction(() => typeof window.toolbarTest.releaseSearch === "function");
  await choose("Category", "Utility"); await results("Utility Mod");
  await page.evaluate(() => window.toolbarTest.releaseSearch()); await settle();
  assert.equal(await page.locator(".catalog-item").first().locator("b").textContent(), "Utility Mod");
  // Search failures offer retry without showing results from another filter.
  await page.evaluate(() => { window.toolbarTest.failSearch = true; });
  await choose("Sort results", "Newest");
  await page.getByRole("button", { name: "Try again", exact: true }).waitFor();
  assert.equal(await page.locator(".catalog-item").count(), 0);
  await page.evaluate(() => { window.toolbarTest.failSearch = false; });
  await page.getByRole("button", { name: "Try again", exact: true }).click(); await results("Utility Mod");
  await sidebar.getByRole("button", { name: "Reset filters", exact: true }).click(); await results("Catalog Sample");

  const back = page.getByRole("button", { name: "Back to installed mods" });
  await settle();
  const exit = await measureTransition(back);
  checkSlide(exit, -1);
  assert.ok(exit.samples[1].catalog.row?.includes("Catalog Sample"), "Catalog rows stay visible during the exit crossfade");
  assert.equal(exit.samples[2].installed.width, coldEntry.samples[0].installed.width, "Installed rows return to their full display area");
  await settle();
  checkSlide(await measureTransition(addMods), 1);
  await results("Catalog Sample");
  await page.setViewportSize({ width: 760, height: 900 }); await settle();
  const compactRail = await sidebar.boundingBox();
  const compactList = await page.locator('[data-mods-layer="catalog"]').boundingBox();
  assert.ok(compactList.y >= compactRail.y + compactRail.height && Math.abs(compactList.x - compactRail.x) < 1, "Narrow windows stack the sidebar above results");
  for (const theme of ["oled", "light"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const control of await sidebar.locator("button").all()) {
      await control.scrollIntoViewIfNeeded();
      const rect = await control.boundingBox();
      assert.ok(rect.x >= compactRail.x && rect.x + rect.width <= compactRail.x + compactRail.width + 1 && rect.y >= compactRail.y && rect.y + rect.height <= compactRail.y + compactRail.height + 1, "All compact controls can scroll into view");
    }
    await sidebar.evaluate(el => { el.scrollTop = 0; });
    await page.screenshot({ path: `logs/catalog-filter-sidebar/compact-${theme}.png` });
  }
  await back.click();
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await addMods.click();
    assert.ok(await sidebar.evaluate(el => [el, el.parentElement].every(node => parseFloat(getComputedStyle(node).transitionDuration) <= 0.000001)));
    await back.click();
  }
  assert.equal(await sidebar.count(), 0, "Back closes catalog filters without opening installed filters");
  await search.fill("Mod 78");
  assert.equal(await page.locator(".content-search-hint").isVisible(), false, "Typed text replaces the animated hint");
  assert.equal(await page.locator(".installed-content-item").count(), 1, "Installed search still finds disabled mods");
  await search.fill("");
  for (const name of ["Resource packs", "Shaders"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    assert.equal(await toolbar.getByRole("button", { name: /filter/i }).count(), 0);
    const category = name === "Resource packs" ? "Resource Packs" : name;
    await toolbar.getByRole("button", { name: `Add ${category}`, exact: true }).click();
    assert.equal(await toolbar.getByRole("button", { name: /filter/i }).count(), 0);
    await toolbar.getByRole("button", { name: `Back to installed ${name.toLowerCase()}`, exact: true }).click();
  }
  assert.deepEqual(errors, []);
  console.log("Passed: smooth Add/Back width, scale, outline and text, no toolbar Filter buttons, installed search, synchronized drawer and fixed-size list crossfade, catalog filters, paging, compatibility, keyboard navigation, compact Light/OLED and motion settings. Native calls simulated.");
} finally { await browser.close(); }
