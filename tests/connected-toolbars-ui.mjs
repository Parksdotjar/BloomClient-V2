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
  const shots = Array.from({ length: 4 }, (_, i) => ({ instanceId: String(i % 2), instanceName: instances[i % 2].name, name: `landscape-${i}.png`, modified: 1792454400000 + i * 86400000, revision: String(i) }));
  const image = "data:image/svg+xml," + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#769aab"/><path d="M0 280L180 100L330 290L470 160L640 260V360H0Z" fill="#476d61"/><path d="M0 310L240 250L500 320L640 280V360H0Z" fill="#2b4c3e"/></svg>');
  instances[0].icon = image;
  instances[0].loaderVersion = "0.18.4";
  instances[2].icon = "data:image/png;base64,AAAA";
  window.toolbarTest = { calls: [], delayRefresh: false, releaseRefresh: null };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.toolbarTest.calls.push({ command, args });
      if (command === "ask_delight_scope") return "fixture";
      if (command === "ask_delight_history") return { version: 1, save: true, selected: null, threads: ["Shader setup", "Fabric mods"].map(text => ({ id: text, updated: Date.now(), messages: [{ id: text, role: "question", text }] })) };
      if (command === "ask_delight_remote") return args.body ? {error: "provider_unavailable"} : {
        usage: {mode: "mock", dailyRemaining: 99, dailyLimit: 100, monthlyRemaining: 999, monthlyLimit: 1000,
          serverTime: Date.now(), dailyReset: Date.now() + 60000, monthlyReset: Date.now() + 60000, blocking: null}
      };
      if (command === "list_instance_content" && window.toolbarTest.checkInventory && args.category === "mods") {
        return Array.from({length:106}, (_, i) => ({name:"Fixture mod " + i, version:"2.4", fileName:i + (i ? ".jar" : ".jar.disabled"), enabled:!!i}));
      }
      if (command === "list_instance_content") return [];
      if (command === "list_instances") return instances;
      if (command === "list_instance_folders") return [];
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
  const library = page.getByRole("navigation", { name: "Your instances" });
  const first = library.locator(".instance-nav-name").first();
  assert.equal(await first.getAttribute("aria-current"), "page");
  assert.equal(await library.locator(".desktop-instance-link").count(), 3);
  const mainBefore = await page.locator("main.content").boundingBox();
  const trigger = page.getByRole("button", { name: "Filter instances" });
  await trigger.click();
  const drawer = page.locator(".instance-nav-filters");
  await drawer.getByRole("menuitem", { name: "Mod loader" }).click();
  await page.getByRole("menuitemradio", { name: "Fabric", exact: true }).click();
  await trigger.click();
  assert.equal(await library.locator(".desktop-instance-link").count(), 2);
  await drawer.getByRole("textbox", { name: "Search instances" }).fill("Creative");
  assert.equal(await library.locator(".desktop-instance-link").count(), 1);
  assert.deepEqual(await page.locator("main.content").boundingBox(), mainBefore);
  await shot("instances-filters");
  await page.keyboard.press("Escape");
  assert.equal(await library.locator(".desktop-instance-link").count(), 1);
  await trigger.click();
  await page.getByRole("menuitem", { name: "Reset filters", exact: true }).click();
  assert.equal(await library.locator(".desktop-instance-link").count(), 3);
  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Screenshots", exact: true }).click();
  await page.locator(".shelf-grid article").first().waitFor();
  assert.equal(await page.locator(".shot-day").count(), 4);
  await nav("Alula");
  const chat = page.locator("main.content").getByRole("region", {name:"Alula", exact:true});
  await chat.getByRole("textbox", {name:"Your question"}).fill("Draft for later");
  assert.equal(await page.locator("aside[aria-label='Alula']").count(), 0);
  await nav("Home");
  await nav("Alula");
  assert.equal(await chat.getByRole("textbox", {name:"Your question"}).inputValue(), "Draft for later");
  const chats = page.locator(".desktop-context").getByRole("region", {name: "Recent chats"});
  for (const title of ["Shader setup", "Fabric mods"]) {
    await chats.getByRole("button", {name: new RegExp("^" + title)}).click();
    await chat.getByRole("log").getByText(title, {exact: true}).waitFor();
  }
  await chats.getByRole("button", {name: "New chat"}).click();
  await chat.getByRole("heading", {name: "How can I help?"}).waitFor();
  assert.equal(await chat.getByRole("button", {name: "Chat history"}).count(), 0);
  await page.evaluate(() => {window.toolbarTest.checkInventory = true;});
  await chat.getByRole("button", {name:"Select modpack", exact:true}).click();
  await chat.getByRole("button", {name:/^Meadow/}).click();
  const info = chat.getByRole("button", {name:"Preview pack context"});
  const review = chat.getByRole("region", {name:"Review pack context"});
  assert.equal(await review.count(), 0);
  await info.click(); assert.equal(await review.count(), 0);
  await info.dblclick(); await review.getByText(/Fixture mod 105/).waitFor();
  await info.press("Enter"); assert.equal(await review.count(), 0);
  const question = chat.getByRole("textbox", {name:"Your question"});
  await question.fill("Which mods should I keep?"); await question.press("Enter");
  await page.waitForFunction(() => window.toolbarTest.calls.some(call => call.args?.body?.context?.inventory));
  const attached = await page.evaluate(() => window.toolbarTest.calls.find(call => call.args?.body?.context?.inventory).args.body);
  assert.equal(attached.question, "Which mods should I keep?");
  assert.equal(attached.context.inventory.mods.length, 105);
  assert.deepEqual(attached.context.inventory.disabled, ["Fixture mod 0 2.4"]);
  assert.equal(attached.context.inventory.minecraft, "1.21.1");
  assert.equal(attached.context.inventory.loaderVersion, "0.18.4");
  assert.equal(attached.context.inventory.mods.at(-1), "Fixture mod 105 2.4");
  await page.evaluate(() => {window.toolbarTest.checkInventory = false;});
  await nav("Screenshots");
  const filters = page.getByRole("navigation", {name: "Screenshot library"});
  const meadow = filters.getByRole("button", {name: "Meadow", exact: true});
  const art = meadow.locator("img");
  await art.evaluate(img => img.decode());
  assert.deepEqual(await art.evaluate(img => [getComputedStyle(img).width, getComputedStyle(img).borderRadius]), ["29px", "8px"]);
  for (const name of ["Vanilla", "Creative"]) await filters.getByRole("button", {name}).locator("svg").waitFor();
  await meadow.click();
  assert.equal(await page.locator(".shelf-grid article").count(), 2);
  await filters.getByRole("button", {name: "All screenshots"}).click();
  const actions = page.getByRole("button",{name:"Actions for landscape-3.png"});
  const assertFlat = async button => {
    const material = await button.evaluate(el => {
      const style = getComputedStyle(el);
      return [style.backgroundImage, style.boxShadow];
    });
    assert.deepEqual(material, ["none", "none"], "Screenshot actions use a flat surface");
  };
  await assertFlat(page.getByRole("button",{name:"Refresh screenshots"}));
  await assertFlat(page.getByRole("button",{name:"Compare",exact:true}));
  await actions.click();
  for (const item of await page.getByRole("menu",{name:"Screenshot actions"}).getByRole("menuitem").all()) {
    const gap = await item.evaluate(el => {
      const label = document.createRange();
      label.selectNodeContents(el.lastChild);
      return label.getBoundingClientRect().left - el.querySelector("svg").getBoundingClientRect().right;
    });
    assert.ok(gap >= 5 && gap <= 14, "Menu label sits next to its leading icon");
  }
  await page.getByRole("menuitem",{name:"Copy image"}).click();
  await page.getByRole("button",{name:"Preview landscape-3.png from Vanilla"}).click();
  const viewer = page.getByRole("dialog",{name:"landscape-3.png"});
  const viewerImage = viewer.locator(".shot-stage img");
  await viewerImage.waitFor();
  await page.waitForFunction(() => !!document.querySelector(".shot-viewer")?.style.getPropertyValue("--shot-aspect"));
  assert.ok(await viewerImage.evaluate(img => {
    const bounds = img.getBoundingClientRect(), dialog = img.closest("dialog").getBoundingClientRect();
    return Math.abs(bounds.width - dialog.width + 2) < 1 && Math.abs(bounds.bottom - dialog.bottom + 1) < 1
      && Math.abs(bounds.height - bounds.width * img.naturalHeight / img.naturalWidth) < 1;
  }), "Image fills the viewer edge-to-edge at its natural aspect ratio");
  assert.equal(await viewer.locator("footer").count(), 0);
  assert.deepEqual(await viewer.locator("header button").evaluateAll(buttons => buttons.map(b => [b.getAttribute("aria-label"), b.textContent])), [
    ["Copy image",""], ["Open folder",""], ["Close preview",""],
  ]);
  await viewer.getByRole("button",{name:"Open folder"}).click();
  await viewer.getByRole("button",{name:"Close preview"}).click();
  for (const action of ["copy","folder"]) assert.ok(await page.evaluate(action=>window.toolbarTest.calls.some(c=>c.command==="screenshot_action" && c.args.action===action && c.args.name==="landscape-3.png"),action));
  const compare = page.locator(".shelf-comparison-toolbar button");
  const shelfHeading = page.locator(".shot-library-heading");
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
  await page.locator(".shot-library-heading h1").hover();
  await compare.hover();
  assert.equal(await compare.textContent(), "Cancel");
  assert.equal((await compare.boundingBox()).width, compareBefore.width);
  await settle(); await toolbarShot("screenshot-toolbar-cancel");
  await page.locator(".shot-library-heading h1").hover();
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
  const shotNav = page.getByRole("navigation", {name:"Screenshot library"});
  await shotNav.getByRole("button", {name:"Vanilla",exact:true}).click();
  await page.getByRole("button", { name: "Select landscape-1.png from Vanilla for comparison", exact: true }).click();
  assert.equal(await compare.textContent(), "Compare (2/2)", "Selection survives instance filters");
  await compare.hover();
  assert.equal(await compare.textContent(), "Compare (2/2)", "A complete pair compares instead of cancelling on hover");
  await assertFlat(compare);
  await settle(); await shot("screenshots-selection");
  await toolbarShot("screenshot-toolbar");
  await compare.click();
  await page.getByRole("slider", { name: "Screenshot comparison divider" }).waitFor();
  const slider = page.getByRole("slider",{name:"Screenshot comparison divider"});
  await slider.press("End");
  assert.equal(await slider.getAttribute("aria-valuenow"),"100");
  await page.getByRole("button",{name:"Reset",exact:true}).click();
  assert.equal(await slider.getAttribute("aria-valuenow"),"50");
  await page.getByRole("button",{name:"Swap",exact:true}).click();
  await page.getByRole("button",{name:"Export",exact:true}).click();
  await page.waitForFunction(()=>window.toolbarTest.calls.some(c=>c.command==="save_screenshot_comparison" && c.args.png.startsWith("data:image/png")));
  await page.getByRole("button", { name: "Close comparison" }).click();
  assert.equal(await compare.evaluate(el => el === document.activeElement), true);
  const letters = page.locator(".shelf-selection-mark");
  assert.deepEqual(await letters.allTextContents(), ["A","B"]);
  await page.getByRole("button",{name:"Cancel",exact:true}).click();
  assert.equal(await letters.count(),0);
  await compare.click();
  await page.locator(".shelf-thumbnail").nth(0).click();
  await page.locator(".shelf-thumbnail").nth(1).click();
  await compare.click();
  await page.getByRole("dialog").getByRole("button",{name:"Cancel",exact:true}).click();
  assert.equal(await page.getByRole("dialog").count(),0);
  assert.equal(await letters.count(),0);
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
    await page.locator(".shot-library-heading h1").hover(); await compare.hover();
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
    await page.locator(".shot-library-heading h1").hover(); await compare.hover();
    assert.equal(await compare.textContent(), "Cancel");
    assert.equal(await compare.locator(".toolbar-copy").evaluate(el => getComputedStyle(el).animationName), "none");
  }
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { document.documentElement.dataset.animations = "on"; document.documentElement.dataset.performance = "normal"; });

  await page.getByRole("menuitem", { name: "View", exact: true }).click();
  await page.getByRole("menuitem", { name: "Locker", exact: true }).click();
  const categories = page.getByRole("navigation", { name: "Locker categories" });
  await page.getByRole("heading", {name:"Equipped look"}).waitFor();
  await categories.getByRole("button", {name:"Capes",exact:true}).click();
  await page.keyboard.press("Tab"); await page.keyboard.press("Enter");
  assert.equal(await categories.getByRole("button", {name:"Skins",exact:true}).getAttribute("aria-current"),"page");
  await page.getByRole("button",{name:"Redeem code"}).click();
  await page.getByRole("textbox",{name:"Enter cape code"}).waitFor();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("textbox",{name:"Enter cape code"}).count(),0);
  await shot("locker-sidebar");
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
  const importPack = page.getByRole("region", { name: "Add a Modrinth modpack" }).getByRole("button", { name: "Import", exact: true });
  await importPack.waitFor();
  await settle(); await shot("modpack-versions");
  await back.click();
  assert.equal(await close.evaluate(el => el === window.packButton && el === document.activeElement), true);
  await page.getByRole("button", { name: "Choose a version of Sample Pack" }).click();
  await importPack.click();
  await page.waitForFunction(() => window.toolbarTest.calls.some(c => c.command === "import_modrinth_modpack" && c.args.projectId === "pack-1" && c.args.versionId === "release-1"));
  assert.equal(await page.getByRole("region", { name: "Add a Modrinth modpack" }).count(), 0);
  assert.deepEqual(errors, []);
  console.log("Passed: instance filtering/search and anchored geometry; comparison selection/filter/removal/escape/native preview; truthful refresh; Locker keyboard/selection; persistent modpack Back/Close and native import; themes, compact layout and motion preferences. Native calls simulated.");
} catch (error) { await shot("failure"); throw error; }
finally { await browser.close(); }
