// Run against Vite. This exercises the real React library with a persistent native-call fixture.
// Rust unit tests separately cover disk persistence, validation and atomic replacement.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", e => errors.push(e.message));
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#f24f54", animations: true, buttonPressDuration: 0 }));
  const art = (color, letter) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/><text x="50" y="68" text-anchor="middle" fill="white" font-family="sans-serif" font-size="48" font-weight="bold">${letter}</text></svg>`);
  const instances = ["Meadow", "Vanilla", "Creative", "Adventure"].map((name, i) => ({ id: String(i), name, loader: i === 1 ? "Vanilla" : "Fabric", version: "1.21.1", directory: `C:/Bloom/instances/${name}`, java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true, icon: i === 3 ? undefined : art(["#55795e", "#a18350", "#677fa6"][i], name[0]) }));
  window.folderTest = { calls: [], failSave: false, failLoad: false, delaySave: false, releaseSave: null, instances };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.folderTest.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_instance_folders") {
        if (window.folderTest.failLoad) throw "Folder file unreadable";
        return JSON.parse(localStorage.getItem("test-folders") || "[]");
      }
      if (command === "change_instance_folder") {
        if (window.folderTest.delaySave) await new Promise(resolve => window.folderTest.releaseSave = resolve);
        if (window.folderTest.failSave) throw "Folder file is read-only";
        let folders = JSON.parse(localStorage.getItem("test-folders") || "[]");
        const c = args.change;
        if (c.action === "create") {
          if (folders.some(f => f.name.toLowerCase() === c.name.trim().toLowerCase())) throw "A folder already uses that name.";
          for (const f of folders) f.instanceIds = f.instanceIds.filter(id => !c.instanceIds.includes(id));
          folders.push({ id: crypto.randomUUID(), name: c.name.trim(), instanceIds: c.instanceIds });
        } else if (c.action === "rename") folders.find(f => f.id === c.folderId).name = c.name.trim();
        else if (c.action === "move") {
          for (const f of folders) f.instanceIds = f.instanceIds.filter(id => id !== c.instanceId);
          if (c.folderId) folders.find(f => f.id === c.folderId).instanceIds.push(c.instanceId);
        } else if (c.action === "dissolve") folders = folders.filter(f => f.id !== c.folderId);
        localStorage.setItem("test-folders", JSON.stringify(folders));
        return folders;
      }
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "get_minecraft_releases") return [{ id: "1.21.1", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});
const settle = () => page.waitForTimeout(380);
const nav = () => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Instances", exact: true }).click();
const folder = name => page.locator(".instance-folder-entry").filter({ has: page.locator(".instance-folder-title strong", { hasText: name }) });
const card = name => page.locator(".instance-library-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("test-folders") || "[]"));
const calls = () => page.evaluate(() => window.folderTest.calls.filter(c => c.command === "change_instance_folder").length);
const screenshot = async name => { if (process.env.FOLDER_SCREENSHOTS) { await mkdir(process.env.FOLDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.FOLDER_SCREENSHOTS}/${name}.png` }); } };
const startDrag = async name => {
  const identity = card(name).locator(".library-card-identity");
  await identity.scrollIntoViewIfNeeded(); const b = await identity.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + 35); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + 35, { steps: 3 });
  await page.locator(".instance-folder-ghost").waitFor();
};
const drop = async locator => {
  const b = await locator.boundingBox(); assert.ok(b);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.waitForTimeout(100); await page.mouse.up(); await settle();
};
const organize = async name => {
  await page.getByRole("button", { name: `Actions for ${name}`, exact: true }).click();
  await page.getByRole("button", { name: "Move to folder", exact: true }).click();
};
try {
  await page.goto(url); await nav(); await card("Meadow").waitFor(); await page.waitForTimeout(1200);
  const sidebar = await page.locator(".sidebar-navigation").boundingBox();
  const searchDock = await page.locator(".instances-search-dock").boundingBox();
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: "Folder name", exact: true }).fill("Survival");
  await dialog.getByRole("checkbox", { name: /Meadow/ }).check();
  await dialog.getByRole("checkbox", { name: /Creative/ }).check();
  await dialog.getByRole("button", { name: "Create folder", exact: true }).click();
  await dialog.waitFor({ state: "detached" }); await settle();
  assert.deepEqual((await stored())[0].instanceIds, ["0", "2"]);
  assert.equal(await folder("Survival").locator(".instance-folder-cover").getAttribute("aria-expanded"), "true");
  assert.equal(await folder("Survival").locator(".instance-folder-members .instance-library-card").count(), 2);
  assert.equal(await card("Meadow").getByRole("button", { name: "Play", exact: true }).isVisible(), true);
  assert.deepEqual(await page.locator(".sidebar-navigation").boundingBox(), sidebar);
  assert.deepEqual(await page.locator(".instances-search-dock").boundingBox(), searchDock);
  await screenshot("tray-oled");
  await folder("Survival").locator(".instance-folder-cover").click(); await settle();
  assert.equal(await folder("Survival").locator(".instance-folder-tray-reveal").getAttribute("inert"), "");
  assert.equal((await folder("Survival").locator(".instance-folder-tray-reveal").boundingBox()).height, 0);
  await screenshot("stack-oled");
  await page.reload(); await nav(); await folder("Survival").waitFor();
  assert.deepEqual((await stored())[0].instanceIds, ["0", "2"], "Grouping survives a library remount and restart fixture");
  await page.getByRole("textbox", { name: "Search your instances" }).fill("Creative");
  assert.equal(await page.locator(".instance-folder-entry").count(), 1);
  await folder("Survival").locator(".instance-folder-cover").click(); await settle();
  assert.equal(await folder("Survival").locator(".instance-library-card").count(), 1);
  await page.getByRole("textbox", { name: "Search your instances" }).fill("Survival");
  assert.equal(await folder("Survival").locator(".instance-library-card").count(), 2);
  await page.getByRole("button", { name: "Clear instance search" }).click();
  await folder("Survival").getByRole("button", { name: "Rename", exact: true }).click();
  await folder("Survival").getByRole("textbox", { name: "Folder name" }).fill("Our worlds");
  await page.getByRole("button", { name: "Save folder name" }).click(); await settle();
  assert.equal((await stored())[0].name, "Our worlds");
  await folder("Our worlds").locator(".instance-folder-cover").click(); await settle();
  await startDrag("Vanilla"); await drop(folder("Our worlds").locator(".instance-folder-cover"));
  assert.deepEqual((await stored())[0].instanceIds, ["0", "2", "1"], "Dropping on a collapsed stack moves the instance");
  await folder("Our worlds").locator(".instance-folder-cover").click(); await settle();
  await startDrag("Creative");
  await drop(page.locator(".instance-folder-drop-out"));
  assert.deepEqual((await stored())[0].instanceIds, ["0", "1"], "Dragging out removes membership");
  assert.equal(await page.locator(".instance-folder-loose").locator(".instance-library-card").filter({ hasText: "Creative" }).count(), 1);
  const beforeCancel = await calls();
  await startDrag("Meadow"); await page.keyboard.press("Escape"); await page.mouse.up(); await settle();
  assert.equal(await calls(), beforeCancel, "Escape never saves or launches a dragged instance");
  assert.equal(await page.locator(".instance-folder-ghost").count(), 0);
  assert.equal(await folder("Our worlds").locator(".instance-folder-cover").getAttribute("aria-expanded"), "true");
  await startDrag("Meadow"); await page.mouse.move(5, 5); await page.mouse.up(); await settle();
  assert.equal(await calls(), beforeCancel, "Dropping outside the library leaves membership unchanged");
  // Native save failure keeps the old visible membership and provides an error.
  await page.evaluate(() => window.folderTest.failSave = true);
  await startDrag("Meadow"); await drop(page.locator(".instance-folder-drop-out"));
  await page.getByRole("alert").waitFor(); assert.equal(await folder("Our worlds").locator(".instance-library-card").count(), 2);
  assert.deepEqual((await stored())[0].instanceIds, ["0", "1"]);
  await page.evaluate(() => window.folderTest.failSave = false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await organize("Meadow"); await dialog.getByRole("button", { name: "Outside folders" }).click(); await settle();
  assert.deepEqual((await stored())[0].instanceIds, ["1"], "The accessible menu performs the same move");
  await organize("Meadow"); await dialog.getByRole("button", { name: "Our worlds", exact: true }).click(); await settle();
  assert.deepEqual((await stored())[0].instanceIds, ["1", "0"]);
  await folder("Our worlds").locator(".instance-folder-cover").click(); await settle();
  await startDrag("Creative"); await drop(card("Adventure").locator(".library-card-identity"));
  assert.equal(await dialog.getByRole("checkbox", { name: /Creative/ }).isChecked(), true);
  assert.equal(await dialog.getByRole("checkbox", { name: /Adventure/ }).isChecked(), true);
  await dialog.getByRole("textbox", { name: "Folder name" }).fill("Building");
  await dialog.getByRole("button", { name: "Create folder", exact: true }).click(); await settle();
  assert.equal((await stored()).length, 2, "Dragging two loose instances together creates a named folder");
  await screenshot("two-folders");
  await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.style.setProperty("--accent", "#397bdc"); });
  await screenshot("tray-light");
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    assert.equal(await folder("Building").locator(".instance-folder-tray-reveal").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
    assert.equal(await folder("Building").locator(".instance-organizable").first().evaluate(el => getComputedStyle(el).animationName), "none");
  }
  await page.setViewportSize({ width: 1050, height: 760 }); await settle(); await screenshot("tray-small-window");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, "Tray fits the supported small window");
  await folder("Building").getByRole("button", { name: "Ungroup", exact: true }).click();
  await folder("Building").getByRole("button", { name: "Ungroup folder", exact: true }).click(); await settle();
  assert.equal((await stored()).length, 1);
  assert.equal(await page.locator(".instance-folder-loose .instance-library-card").count(), 2, "Ungroup returns members without deleting them");
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await dialog.getByRole("textbox", { name: "Folder name" }).fill("Empty folder");
  await dialog.getByRole("button", { name: "Create folder", exact: true }).click(); await settle();
  assert.equal(await folder("Empty folder").locator(".instance-folder-empty").isVisible(), true);
  await page.keyboard.press("Escape");
  assert.equal(await folder("Empty folder").locator(".instance-folder-cover").evaluate(el => el === document.activeElement), true, "Escape returns focus to the stack");
  // Failure to read organization must not block access to existing instances.
  await page.evaluate(() => { window.folderTest.failLoad = true; });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Home", exact: true }).click();
  await nav(); await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".instance-library-card").count(), 4);
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  assert.equal(await dialog.getByRole("button", { name: "Create folder", exact: true }).isDisabled(), true);
  await page.evaluate(() => window.folderTest.failLoad = false);
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await page.keyboard.press("Escape"); await settle();
  assert.equal(await page.locator(".instance-folder-entry").count(), 2);
  assert.equal(await page.evaluate(() => window.folderTest.calls.some(c => /launch_minecraft|delete_instance|open_instance_folder/.test(c.command))), false, "Organization does not launch, open or delete game files");
  assert.deepEqual(errors, []);
  console.log("Instance folders: create, persistence, stacked tray, search, rename, drag-in/out/create/cancel, failed writes, menu moves, ungroup, empty folders, theme/motion, small windows and read recovery passed.");
} catch (error) { await screenshot("failure"); console.log(await page.locator(".instance-folders-grid, .instance-folder-entry, .instance-folder-members, .instance-organizable, .instance-library-card").evaluateAll(els => els.map(el => { const s = getComputedStyle(el), b = el.getBoundingClientRect(); return { cls: el.className, x: b.x, y: b.y, h: b.height, rows: s.gridTemplateRows, gap: s.rowGap, margin: s.margin, transform: s.transform, display: s.display, align: s.alignSelf, height: s.height, max: s.maxHeight }; }))); throw error; }
finally { await browser.close(); }
