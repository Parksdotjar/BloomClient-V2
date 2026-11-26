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
      if (command === "list_instance_content") return [];
      if (command === "list_instance_folders") {
        if (sessionStorage.getItem("delay-folder-read")) {
          await new Promise(resolve => window.folderTest.releaseRead = resolve);
        }
        if (window.folderTest.failLoad || sessionStorage.getItem("fail-folder-read")) throw "Folder file unreadable";
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
        } else if (c.action === "reorder") {
          const moved = folders.find(f => f.id === c.folderId);
          folders = folders.filter(f => f !== moved);
          folders.splice(folders.findIndex(f => f.id === c.targetId) + Number(c.after), 0, moved);
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
const nav = async () => { await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Instances", exact: true }).click(); };
const folder = name => page.locator(".folder-section").filter({ has: page.getByRole("button", { name, exact: true }) });
const card = name => page.locator(".desktop-instance-link").filter({ has: page.getByRole("button", { name, exact: true }) });
const stored = () => page.evaluate(() => JSON.parse(localStorage.getItem("test-folders") || "[]"));
const calls = () => page.evaluate(() => window.folderTest.calls.filter(c => c.command === "change_instance_folder").length);
const screenshot = async name => { if (process.env.FOLDER_SCREENSHOTS) { await mkdir(process.env.FOLDER_SCREENSHOTS, { recursive: true }); await page.screenshot({ path: `${process.env.FOLDER_SCREENSHOTS}/${name}.png` }); } };
const startDrag = async name => {
  const identity = card(name).locator(".instance-nav-name");
  await identity.scrollIntoViewIfNeeded(); const b = await identity.boundingBox();
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2); await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 12, b.y + b.height / 2, { steps: 3 });
  await page.locator(".instance-folder-ghost").waitFor();
};
const drop = async locator => {
  const b = await locator.boundingBox(); assert.ok(b);
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 12 });
  await page.waitForTimeout(100); await page.mouse.up(); await settle();
};
const organize = async name => {
  await card(name).locator(".instance-nav-name").click({ button: "right" });
};
const heading = name => folder(name).locator(".folder-toggle");
const saveName = async name => {
  await page.getByRole("textbox", { name: "Folder name" }).fill(name);
  await page.getByRole("button", { name: "Save folder" }).click();
  await heading(name).waitFor();
};
const create = async name => {
  await page.getByRole("button", { name: "New folder", exact: true }).click();
  await saveName(name);
};
async function dragFolder(name, destination, after) {
  const from = await heading(name).boundingBox(), to = await heading(destination).boundingBox();
  await page.mouse.move(from.x + 20, from.y + from.height / 2);
  await page.mouse.down(); await page.mouse.move(to.x + 20, to.y + (after ? to.height - 3 : 3), { steps: 8 });
  await page.waitForFunction(({ name, edge }) => document.querySelector(`.folder-section[data-folder-drop-active="${edge}"] .folder-toggle`)?.textContent === name, { name: destination, edge: after ? "after" : "before" });
  await page.mouse.up(); await settle();
}
try {
  await page.goto(url); await nav(); await card("Meadow").waitFor();
  await create("Survival"); await create("Building");
  await heading("Survival").hover();
  assert.equal(await folder("Survival").locator(".folder-section-heading button").count(), 1);
  const survival = heading("Survival");
  await survival.locator("svg.lucide-folder-open:first-child").click();
  assert.equal(await survival.getAttribute("aria-expanded"), "false");
  await survival.locator("svg.lucide-folder:first-child").click();
  assert.equal(await survival.getAttribute("aria-expanded"), "true");
  assert.equal(await survival.locator("svg").count(), 1);
  await card("Creative").hover();
  assert.equal(await card("Creative").getByRole("button").count(), 1);
  await organize("Creative");
  await page.getByRole("dialog", { name: "Move Creative" }).getByRole("button", { name: "Close" }).click();
  await startDrag("Meadow"); await drop(heading("Survival"));
  await startDrag("Creative"); await drop(heading("Survival"));
  assert.deepEqual((await stored())[0].instanceIds, ["0", "2"]);
  const folderReads = () => page.evaluate(() => window.folderTest.calls.filter(c => c.command === "list_instance_folders").length);
  const initialReads = await folderReads();
  assert.equal(initialReads, 1);
  await card("Creative").locator(".instance-nav-name").click();
  await folder("Survival").getByRole("button", { name: "Creative", exact: true }).waitFor();
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Locker", exact: true }).click();
  await nav();
  await folder("Survival").getByRole("button", { name: "Creative", exact: true }).waitFor();
  assert.equal(await folderReads(), initialReads, "Selecting an instance and returning to the sidebar reuse its layout");
  await create("Testing");
  await dragFolder("Survival", "Building", true);
  assert.deepEqual((await stored()).map(f => f.name), ["Building", "Survival", "Testing"]);
  await page.evaluate(() => sessionStorage.setItem("delay-folder-read", "1"));
  await page.reload(); await nav();
  await page.waitForFunction(() => !!window.folderTest.releaseRead);
  assert.equal(await page.locator(".instance-folder-loose .desktop-instance-link").count(), 0, "Cold start must not paint a provisional ungrouped list");
  await page.evaluate(() => { sessionStorage.removeItem("delay-folder-read"); window.folderTest.releaseRead(); });
  await heading("Survival").waitFor();
  assert.deepEqual(await page.locator(".folder-toggle").allTextContents(), ["Building", "Survival", "Testing"]);
  assert.deepEqual((await stored())[1].instanceIds, ["0", "2"]);
  await dragFolder("Survival", "Building", false);
  await heading("Survival").focus();
  await page.keyboard.press("Alt+ArrowDown");
  await page.waitForFunction(() => document.querySelector(".folder-toggle")?.textContent === "Building");
  await page.keyboard.press("Alt+ArrowUp");
  await page.waitForFunction(() => document.querySelector(".folder-toggle")?.textContent === "Survival");
  await heading("Testing").click({ button: "right" });
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await page.getByRole("button", { name: "Remove folder", exact: true }).click();
  await heading("Building").click();
  await startDrag("Creative"); await drop(heading("Building"));
  assert.deepEqual((await stored())[1].instanceIds, ["2"]);
  await heading("Survival").click(); await page.reload(); await nav();
  for (const name of ["Survival", "Building"]) {
    assert.equal(await heading(name).getAttribute("aria-expanded"), "false");
  }
  await page.getByRole("button", { name: "Filter instances" }).click();
  const search = page.getByRole("textbox", { name: "Search instances" });
  await search.fill("Creative"); await card("Creative").waitFor();
  assert.equal(await page.locator(".folder-section").count(), 1);
  await search.fill(""); await page.keyboard.press("Escape");
  assert.equal(await heading("Building").getAttribute("aria-expanded"), "false");
  await heading("Survival").click(); await heading("Building").click();
  await screenshot("inline-folders");
  await startDrag("Creative"); await drop(card("Vanilla").locator(".instance-nav-name"));
  assert.deepEqual((await stored())[1].instanceIds, []);
  await startDrag("Creative"); await drop(heading("Building"));
  await startDrag("Creative");
  const listBounds = await page.getByRole("navigation", { name: "Your instances" }).boundingBox();
  const blankX = listBounds.x + listBounds.width / 2, blankY = listBounds.y + listBounds.height - 6;
  assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.className, [blankX, blankY]), "instance-folders-grid");
  await page.mouse.move(blankX, blankY); await page.mouse.up();
  await page.locator(".instance-folder-loose").getByRole("button", { name: "Creative", exact: true }).waitFor();
  assert.deepEqual((await stored())[1].instanceIds, []);
  const beforeCancel = await calls();
  await startDrag("Meadow"); await page.keyboard.press("Escape"); await page.mouse.up();
  assert.equal(await calls(), beforeCancel);
  await startDrag("Meadow"); await page.mouse.move(4, 4); await page.mouse.up();
  assert.equal(await calls(), beforeCancel);
  await page.evaluate(() => window.folderTest.failSave = true);
  await startDrag("Meadow"); await drop(card("Vanilla").locator(".instance-nav-name"));
  await page.getByRole("alert").waitFor(); assert.deepEqual((await stored())[0].instanceIds, ["0"]);
  await page.evaluate(() => window.folderTest.failSave = false);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await startDrag("Meadow"); await drop(card("Vanilla").locator(".instance-nav-name"));
  assert.deepEqual((await stored())[0].instanceIds, []);
  await page.evaluate(() => window.folderTest.delaySave = true);
  await organize("Meadow");
  await page.getByRole("dialog").getByRole("button", { name: "Building", exact: true }).click();
  await page.waitForFunction(() => !!window.folderTest.releaseSave);
  assert.deepEqual((await stored())[1].instanceIds, [], "A pending move keeps the confirmed membership");
  await page.evaluate(() => { window.folderTest.delaySave = false; window.folderTest.releaseSave(); });
  await folder("Building").getByRole("button", { name: "Meadow", exact: true }).waitFor();
  await heading("Building").click({ button: "right" });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await saveName("Our worlds");
  await page.setViewportSize({ width: 1050, height: 760 }); await screenshot("inline-small");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await heading("Our worlds").click({ button: "right" });
  await page.getByRole("button", { name: "Ungroup", exact: true }).click();
  await page.getByRole("button", { name: "Remove folder", exact: true }).click();
  await page.locator(".instance-folder-loose").getByRole("button", { name: "Meadow", exact: true }).waitFor();
  assert.equal((await stored()).length, 1);
  await page.evaluate(() => sessionStorage.setItem("fail-folder-read", "1"));
  await page.reload();
  await nav(); await page.getByRole("alert").waitFor();
  assert.equal(await page.locator(".desktop-instance-link").count(), 4);
  await page.evaluate(() => sessionStorage.removeItem("fail-folder-read"));
  await page.getByRole("button", { name: "Retry", exact: true }).click(); await heading("Survival").waitFor();
  assert.equal(await page.evaluate(() => window.folderTest.calls.some(c => /launch_minecraft|delete_instance|open_instance_folder/.test(c.command))), false);
  assert.deepEqual(errors, []);
  console.log("Passed leading open/closed folder icons, pointer and keyboard group reordering, saved order, collapse, filtering, drag in/between/out, cancellation, save/read recovery, rename and ungroup.");
} catch (error) { await screenshot("failure"); throw error; }
finally { await browser.close(); }
