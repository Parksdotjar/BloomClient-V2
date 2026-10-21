// Run against Vite with PLAYWRIGHT_MODULE / CHROME_PATH when needed.
// Native calls and image data are fixtures; no account, game or instance files change.
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
  const instances = ["Meadow", "Vanilla", "Creative"].map((name, i) => ({ id: String(i), name, loader: i === 1 ? "Vanilla" : "Fabric", version: "1.21.1", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  const shots = Array.from({ length: 4 }, (_, i) => ({ instanceId: String(i % 2), instanceName: instances[i % 2].name, name: `landscape-${i}.png`, modified: 1792454400000 + i * 1000, revision: String(i) }));
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#769aab"/><path d="M0 280L180 100L330 290L470 160L640 260V360H0Z" fill="#476d61"/><path d="M0 310L240 250L500 320L640 280V360H0Z" fill="#2b4c3e"/></svg>');
  window.toolbarTest = { calls: [], delayRefresh: false, releaseRefresh: null };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.toolbarTest.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_screenshots") {
        if (window.toolbarTest.delayRefresh) await new Promise(resolve => { window.toolbarTest.releaseRefresh = resolve; });
        return { items: shots, warnings: [] };
      }
      if (command === "screenshot_action") return image;
      if (command === "save_screenshot_comparison") return true;
      if (command === "cosmetics_request") return { items: [] };
      if (command === "get_minecraft_releases") return [{ id: "1.21.1", type: "release" }];
      if (command === "detect_java_installations") return [];
      if (command === "search_modrinth_content") return { items: [{ provider: "Modrinth", projectId: "pack-1", slug: "sample", title: "Sample Pack", summary: "A compatible Fabric pack", author: "Author", downloads: 10, loader: "Fabric", gameVersion: "1.21.1", versionId: "v1", versionNumber: "1.0", fileName: "pack.mrpack", fileSize: 1024 }], total: 1, limit: 50, offset: 0 };
      if (command === "list_modrinth_modpack_releases") return [{ id: "release-1", versionNumber: "1.0", versionType: "release", gameVersions: ["1.21.1"], datePublished: "2026-10-20", fileName: "pack.mrpack", fileSize: 1024 }];
      if (command === "import_modrinth_modpack") return "imported";
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
const settle = () => page.waitForTimeout(380);
const nav = name => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
const noMotion = async (mode, target) => {
  await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
  await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
  assert.equal(await target.evaluate(el => getComputedStyle(el).transitionDuration), "0s");
};
try {
  await page.goto(url);
  await nav("Instances");
  await settle();
  const drawer = page.locator(".instances-filter-drawer");
  const trigger = page.getByRole("button", { name: /^Filter instances:/ });
  const dock = page.locator(".instances-search-dock");
  const sidebar = await page.locator(".sidebar-navigation").boundingBox();
  const dockBefore = await dock.boundingBox();
  assert.equal(await page.locator(".instance-library-card").count(), 3);
  await trigger.click(); await settle();
  assert.equal(await drawer.getAttribute("inert"), null);
  assert.ok(Math.abs((await dock.boundingBox()).y - dockBefore.y) < 1, `Instance search stays anchored: ${dockBefore.y} -> ${(await dock.boundingBox()).y}`);
  const heading = await page.locator(".instances-page-heading").boundingBox();
  const tools = await drawer.boundingBox();
  assert.ok(Math.abs(heading.width - tools.width) <= 2 && tools.y > heading.y + heading.height, "Drawer attaches below the full-width title and action shelf");
  assert.equal(await drawer.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)", "Tools extend the existing shelf without a third surface");
  assert.deepEqual(await page.locator(".sidebar-navigation").boundingBox(), sidebar);
  await drawer.getByRole("button", { name: "Fabric", exact: true }).click();
  assert.equal(await page.locator(".instance-library-card").count(), 2);
  await settle();
  await shot("instances-filters");
  await page.keyboard.press("Escape"); await settle();
  assert.equal(await drawer.getAttribute("inert"), "");
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  await page.getByRole("textbox", { name: "Search your instances" }).fill("Creative");
  assert.equal(await page.locator(".instance-library-card").count(), 1);
  await page.getByRole("button", { name: "Clear instance search" }).click();
  await trigger.click();
  await drawer.getByRole("button", { name: "All", exact: true }).click();
  await page.getByRole("textbox", { name: "Search your instances" }).click();
  assert.equal(await trigger.getAttribute("aria-expanded"), "false");

  await nav("Screenshots");
  await page.locator(".shelf-grid article").first().waitFor();
  const compare = page.locator(".shelf-comparison-toolbar button");
  const shelfHeading = page.locator(".shelf-heading-shell");
  const firstImage = page.locator('.shelf-thumbnail').first();
  const headingBefore = await shelfHeading.boundingBox();
  const compareBefore = await compare.boundingBox();
  const toolbarShot = async name => { if (shots) await shelfHeading.screenshot({ path: `${shots}/${name}.png` }); };
  await toolbarShot("screenshot-toolbar-before-selection");
  await compare.evaluate(el => { window.comparisonButton = el; });
  await compare.click();
  assert.equal(await compare.textContent(), "Compare (0/2)", "Starting selection shows the count even while the pointer remains on the button");
  await settle();
  assert.equal(await compare.evaluate(el => el === window.comparisonButton), true);
  assert.equal(await page.locator(".shelf-selection-drawer, .shelf-selection-prompt, .shelf-selected-preview, .shelf-selection-cancel").count(), 0, "Selection has no lower UI or separate cancel button");
  assert.equal((await shelfHeading.boundingBox()).height, headingBefore.height, "Selection does not expand the toolbar");
  assert.equal((await compare.boundingBox()).width, compareBefore.width, "The count does not move neighboring controls");
  assert.equal(await compare.isEnabled(), true, "Incomplete selection can still be cancelled");
  await toolbarShot("screenshot-toolbar-empty");
  await page.locator(".shelf-heading").hover();
  await compare.hover();
  assert.equal(await compare.textContent(), "Cancel");
  assert.equal((await compare.boundingBox()).width, compareBefore.width);
  await settle(); await toolbarShot("screenshot-toolbar-cancel");
  await page.locator(".shelf-heading").hover();
  assert.equal(await compare.textContent(), "Compare (0/2)", "Leaving hover restores the count");
  await compare.click();
  assert.equal(await compare.textContent(), "Compare", "Cancelling at zero returns to browsing");
  await compare.click();
  await firstImage.click();
  assert.equal(await compare.textContent(), "Compare (1/2)");
  await firstImage.click();
  assert.equal(await compare.textContent(), "Compare (0/2)", "Deselecting updates the same count");
  await firstImage.click();
  await compare.hover();
  assert.equal(await compare.textContent(), "Cancel");
  await compare.click();
  assert.equal(await compare.textContent(), "Compare");
  assert.equal(await page.locator('.shelf-thumbnail[aria-pressed="true"]').count(), 0, "Cancelling at one clears selection");

  // Keyboard users can enter, return to Cancel and activate it without hovering.
  await page.locator(".shelf-refresh").focus(); await page.keyboard.press("Tab");
  await page.keyboard.press("Enter");
  assert.equal(await compare.textContent(), "Compare (0/2)");
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Tab");
  assert.equal(await compare.textContent(), "Cancel");
  await page.keyboard.press("Enter");
  assert.equal(await compare.textContent(), "Compare");

  await compare.click();
  await firstImage.click();
  const select = page.locator(".shelf-toolbar .select-trigger");
  await select.click(); await page.keyboard.press("Escape");
  assert.equal(await compare.textContent(), "Compare (1/2)", "Dropdown Escape preserves comparison selection");
  await select.click(); await page.locator(".select-menu-portal").getByRole("button", { name: "Vanilla", exact: true }).click();
  await page.getByRole("button", { name: "Select landscape-1.png from Vanilla for comparison", exact: true }).click();
  assert.equal(await compare.textContent(), "Compare (2/2)", "Selection survives instance filters");
  await compare.hover();
  assert.equal(await compare.textContent(), "Compare (2/2)", "A complete pair compares instead of cancelling on hover");
  await settle(); await shot("screenshots-selection");
  await toolbarShot("screenshot-toolbar");
  await compare.click();
  await page.getByRole("slider", { name: "Screenshot comparison divider" }).waitFor();
  await page.getByRole("button", { name: "Close comparison" }).click();
  assert.equal(await compare.evaluate(el => el === document.activeElement), true);
  await page.getByRole("button", { name: "Select landscape-1.png from Vanilla for comparison", exact: true }).click();
  assert.equal(await compare.textContent(), "Compare (1/2)");
  await page.keyboard.press("Escape"); await settle();
  assert.equal(await compare.textContent(), "Compare");
  assert.equal(await compare.evaluate(el => el === document.activeElement), true);
  await page.evaluate(() => { window.toolbarTest.delayRefresh = true; });
  await page.getByRole("button", { name: "Refresh screenshots" }).click();
  await page.waitForFunction(() => window.toolbarTest.releaseRefresh);
  assert.equal(await page.getByRole("button", { name: "Refresh screenshots" }).isDisabled(), true);
  assert.equal(await page.locator(".shelf-grid article").count(), 2, "Refresh keeps cached gallery visible");
  await page.evaluate(() => { window.toolbarTest.delayRefresh = false; window.toolbarTest.releaseRefresh(); });
  await page.waitForFunction(() => !document.querySelector('.shelf-refresh').disabled);

  for (const theme of ["light", "oled"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    await compare.click(); await settle(); await toolbarShot(`${theme}-comparison-button`);
    await page.locator(".shelf-heading").hover(); await compare.hover();
    await settle(); await toolbarShot(`${theme}-comparison-cancel`);
    assert.equal(await compare.textContent(), "Cancel");
    await compare.click();
  }
  await page.setViewportSize({ width: 900, height: 900 });
  await compare.click(); await settle(); await shot("compact-comparison-button");
  const buttonBounds = await compare.boundingBox();
  const bounds = await shelfHeading.boundingBox();
  assert.ok(buttonBounds.x >= bounds.x && buttonBounds.x + buttonBounds.width <= bounds.x + bounds.width && buttonBounds.y + buttonBounds.height <= bounds.y + bounds.height);
  for (const mode of ["off", "ultra", "reduced"]) {
    await noMotion(mode, compare.locator(".toolbar-icon-swap svg").first());
    await page.locator(".shelf-heading").hover(); await compare.hover();
    assert.equal(await compare.textContent(), "Cancel");
    assert.equal(await compare.locator(".toolbar-copy").evaluate(el => getComputedStyle(el).animationName), "none");
  }
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { document.documentElement.dataset.animations = "on"; document.documentElement.dataset.performance = "normal"; });

  await nav("Locker");
  const tabs = page.getByRole("tablist", { name: "Locker category" });
  await tabs.getByRole("tab", { name: "Capes", exact: true }).click();
  assert.equal(await page.getByRole("tabpanel").getAttribute("aria-labelledby"), "locker-tab-capes");
  await page.keyboard.press("ArrowRight");
  assert.equal(await tabs.getByRole("tab", { name: "Skins", exact: true }).getAttribute("aria-selected"), "true");
  await settle();
  const marker = await tabs.locator("i").boundingBox();
  const activeTab = await tabs.getByRole("tab", { name: "Skins", exact: true }).boundingBox();
  assert.ok(Math.abs(marker.x - activeTab.x) < 2, "Locker marker follows keyboard selection");
  await shot("locker-tabs");
  for (const mode of ["off", "ultra", "reduced"]) await noMotion(mode, tabs.locator("i"));
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { document.documentElement.dataset.animations = "on"; document.documentElement.dataset.performance = "normal"; });

  await nav("Instances");
  await page.getByRole("button", { name: "New instance", exact: true }).click();
  await page.getByRole("button", { name: "Add from Modrinth", exact: true }).click();
  const close = page.getByRole("button", { name: "Close Modpacks", exact: true });
  await close.evaluate(el => { window.packButton = el; });
  await page.getByRole("button", { name: "Choose a version of Sample Pack" }).click();
  const back = page.getByRole("button", { name: "Back to modpacks", exact: true });
  assert.equal(await back.evaluate(el => el === window.packButton && el === document.activeElement), true);
  const importPack = page.getByRole("dialog", { name: "Add a Modrinth modpack" }).getByRole("button", { name: "Import", exact: true });
  await importPack.waitFor();
  await settle(); await shot("modpack-versions");
  await back.click();
  assert.equal(await close.evaluate(el => el === window.packButton && el === document.activeElement), true);
  await page.getByRole("button", { name: "Choose a version of Sample Pack" }).click();
  await importPack.click();
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "import_modrinth_modpack" && c.args.projectId === "pack-1" && c.args.versionId === "release-1"));
  assert.equal(await page.locator(".modrinth-pack-layer").count(), 0);
  assert.deepEqual(errors, []);
  console.log("Passed: instance filtering/search and anchored geometry; comparison selection/filter/removal/escape/native preview; truthful refresh; Locker keyboard/selection; persistent modpack Back/Close and native import; themes, compact layout and motion preferences. Native calls simulated.");
} catch (error) { await shot("failure"); throw error; }
finally { await browser.close(); }
