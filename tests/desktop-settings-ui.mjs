// Click through the redesign using disposable settings, accounts and instances.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import path from "node:path";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, colorScheme: "dark" });
page.setDefaultTimeout(7500);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  const mark = (color, width = 60, height = 60) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${color}"/></svg>`);
  const instances = ["Meadow", "Creative"].map((name, i) => ({ name, id: String(i), version: "1.21.1", loader: "Fabric", directory: name, icon: i ? mark("green", 60, 150) : mark("gold", 150, 60), java: "Automatic", memory: 4096, jvmArguments: "" }));
  const accounts = ["Parks", "Alex"].map(name => ({ name, id: name }));
  let active = accounts[0], next = 1;
  let cache = { directory: "C:/Fixture/Cache", usedBytes: 268435456, capacityBytes: 2147483648, itemCount: 450 };
  window.calls = [];
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(src) { return src; },
    async invoke(cmd, args) {
      window.calls.push({ cmd, args });
      switch (cmd) {
        case "get_global_file_sync_state": return {settings:{optionsSource:null,serversSource:null,voiceChatSource:null,voiceChatTargets:[],shareResourcePacks:false,shareShaderPacks:false},statuses:[],backupRoot:""};
        case "list_instances": return instances;
        case "get_saved_minecraft_profile": return active;
        case "get_minecraft_skin": {
          const skin = document.createElement("canvas");
          skin.width = skin.height = 64;
          const ctx = skin.getContext("2d");
          ctx.fillStyle = args.accountId === "Parks" ? "#285592" : "#706545";
          ctx.fillRect(0, 0, 32, 16); ctx.fillRect(0, 16, 56, 16); ctx.fillRect(16, 48, 32, 16);
          return skin.toDataURL();
        }
        case "list_minecraft_accounts": return { activeId: active.id, accounts };
        case "switch_minecraft_account": return active = accounts.find(a => a.id === args.accountId);
        case "get_minecraft_releases": return [{ id: "1.21.1", type: "release" },{ id: "1.20.1", type: "release" }];
        case "choose_game_directory": return "D:/Fixture/Instances";
        case "choose_fabric_modpack_file": return window.chosenFile ?? null;
        case "import_fabric_modpack": return window.localPack ?? null;
        case "save_instance": return { ...args.config, id:"created" };
        case "list_modrinth_modpack_releases":
          if (window.failRelease) { window.failRelease = false; throw new Error("Release list unavailable"); }
          return ["1.21.1","1.20.1"].map(v => ({ id:v, versionNumber:"3.0", versionType:"release", gameVersions:[v], fileName:"Forest-"+v+".mrpack", fileSize:4096 }));
        case "import_modrinth_modpack":
          if (window.failImport) { window.failImport = false; throw new Error("Import interrupted"); }
          return "imported";
        case "get_content_download_queue": return { revision: 0, tasks: [] };
        case "get_minecraft_launch_status": return { active: false, state: "idle", progress: 0, message: "" };
        case "get_client_cache_status": return {...cache};
        case "choose_client_cache_directory": return "D:/Delight/Cache";
        case "save_client_cache_settings": return cache = {...cache, ...args};
        case "clear_client_cache": return cache = {...cache, usedBytes: 0, itemCount: 0};
        case "request_microsoft_device_code": return {user_code:"TEST-CODE", verification_uri:"https://example.invalid", device_code:"fixture", interval:5};
        case "complete_microsoft_login": return new Promise(() => {});
        case "get_client_cache_settings": return { enabled: true, maxBytes: 3e9 };
        case "list_portal": return { entries: [], warnings: [] };
        case "list_instance_content": return Array.from({ length: args.category === "mods" ? 78 : 2 }, (_, i) => ({ id: String(i), name: args.category === "mods" && i === 0 ? "Mod Menu" : args.category + " " + i, fileName: i + (args.category === "mods" ? ".jar" : ".zip"), version: "1", enabled: i !== 1, size: 400, icon: args.category === "mods" ? null : mark("purple") }));
        case "get_pack_artwork": return { "0.zip": mark(args.category === "shaderpacks" ? "skyblue" : "orange"), "1.zip": "data:image/png;base64,AAAA" };
        case "search_modrinth_content":
          if (args.category === "modpacks" && args.query === "no matches") return {items:[],total:0,limit:50,offset:0};
          if (args.category === "mods") return {
            items: ["Mod Menu", "Mod Menu Command"].map((title, i) => ({
              provider: "modrinth", slug: title.toLowerCase().replaceAll(" ","-"), versionId: "v" + i, gameVersion: "1.21.1", projectId: "mod" + i, title, versionNumber: "2", author: "Test", iconUrl: mark("blue"), fileSize: 64000, fileName: "release-" + i + ".jar", loader: "Fabric"
            })), total: 2, offset: 0, limit: 50
          };
          return { items: [{ provider: "modrinth", slug: "sample-pack", versionId: "test-version", gameVersion: "1.21.1", projectId: "fixture", title: "Catalog pack", versionNumber: "1", author: "Test", iconUrl: mark("green"), fileSize: 1024, fileName: "other.zip", loader: "Minecraft" }], total: 1, offset: 0, limit: 50 };
        case "rename_instance": return Object.assign(instances.find(item => item.id === args.instanceId), { name: args.name });
        case "plugin:event|listen": return next++;
        case "plugin:app|version": return "1.1.8";
        case "list_instance_folders": case "list_pack_channel_memberships": case "list_managed_java_runtimes": case "reconcile_cosmetics": case "list_cached_screenshots": case "detect_java_installations": return [];
        default: return null;
      }
    },
  };
});
const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
const open = name => button(name, page.getByRole("navigation", { name: "Main navigation" })).click();
const photo = async name => {
  if (!process.env.CONTROLS_SCREENSHOTS) return;
  await mkdir(process.env.CONTROLS_SCREENSHOTS, { recursive: true });
  await page.screenshot({ path: path.join(process.env.CONTROLS_SCREENSHOTS, name + ".png"), animations: "disabled" });
};
async function fits(locator) {
  const box = await locator.boundingBox();
  const { width, height } = page.viewportSize();
  assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= height + 1, JSON.stringify(box));
}
async function checkSquareIcon(locator) {
  const { width, height, fit, radius } = await locator.evaluate(async image => {
    await image.decode();
    const { width, height } = image.getBoundingClientRect();
    const style = getComputedStyle(image);
    return { width, height, fit: style.objectFit, radius: parseFloat(style.borderTopLeftRadius) };
  });
  assert.ok(width > 0 && Math.abs(width - height) < 1, `Expected a square icon, got ${width} × ${height}`);
  assert.equal(fit, "cover");
  assert.ok(radius > 0);
}
async function checkInstanceCreation() {
  const start = async () => { await open("Instances"); await button("New instance").click(); };
  const name = page.getByRole("textbox", {name:"Instance name"});
  const chooseOption = async (field, value) => {
    await button(field).click(); await button(value,page.getByRole("dialog",{name:field,exact:true})).click();
  };
  const currentStep = () => page.locator(".creation-steps [aria-current=step]").innerText();
  assert.equal(await currentStep(), "Source");
  await fits(button("Import from file"));
  await photo("creation-source");
  await button("Cancel").click(); await start();
  await button("Start from scratch").click();
  assert.equal(await currentStep(), "Setup");
  assert.ok(await button("Review").isDisabled());
  await name.fill("Forest");
  await chooseOption("Mod loader","Vanilla"); await chooseOption("Minecraft version","1.20.1");
  await chooseOption("Java runtime","Automatic (Recommended)");
  await button("Choose game directory").click();
  assert.equal(await page.getByLabel("Game directory",{exact:true}).inputValue(),"D:/Fixture/Instances");
  const amount=page.getByRole("spinbutton",{name:"Memory in megabytes"});
  await amount.fill("5632"); await amount.press("Enter");
  await page.getByRole("slider",{name:"Memory allocation"}).press("ArrowRight"); assert.equal(await amount.inputValue(),"6144");
  await page.setViewportSize({width:1280,height:800}); await photo("new-instance");
  await button("Advanced options").click();
  for (const label of ["Mods","Resource packs","Shaders","Configuration","Custom resolution","Show in launcher"]) {
    const control=button(label); const old=await control.getAttribute("aria-pressed"); await control.click();
    assert.notEqual(await control.getAttribute("aria-pressed"),old);
  }
  await page.getByRole("textbox",{name:"JVM arguments"}).fill("-Dfixture=true"); await photo("new-instance-advanced");
  await button("Advanced options").click();
  await button("Review").click();
  assert.equal(await currentStep(), "Review");
  await page.getByText("6144 MB", {exact:true}).waitFor();
  await page.getByText("-Dfixture=true", {exact:true}).waitFor();
  await photo("creation-scratch-review");
  await button("Back").click();
  assert.equal(await name.inputValue(),"Forest");
  await button("Back").click();
  await button("Import from file").click();
  await button("Choose file").click();
  assert.ok(await button("Review").isDisabled());
  await button("Back").click();
  await button("Add from Modrinth").click();
  const search=page.getByRole("textbox",{name:"Search Modrinth modpacks"});
  await chooseOption("Filter packs by Minecraft version","1.20.1");
  await search.fill("no matches"); await page.getByText(/No compatible packs found/).waitFor(); await search.fill("");
  const pack=button("Choose a version of Catalog pack"); await pack.waitFor(); await photo("creation-modrinth");
  await page.evaluate(()=>window.failRelease=true); await pack.click(); await button("Retry").click();
  await chooseOption("Supported Minecraft version","1.21.1"); await chooseOption("Modpack release","3.0 · release");
  await page.getByText("Forest-1.21.1.mrpack",{exact:true}).waitFor(); await photo("creation-release");
  await page.keyboard.press("Escape"); await pack.waitFor(); await button("Close Modpacks").click();
  await button("Start from scratch").click();
  assert.equal(await name.inputValue(),"Forest"); await button("Review").click(); await button("Create instance").click();
  const saved=await page.evaluate(()=>window.calls.find(c=>c.cmd==="save_instance").args.config);
  assert.equal(saved.memory,6144); assert.equal(saved.jvmArguments,"-Dfixture=true"); assert.equal(saved.shortcut,false); assert.equal(saved.mods,false);
  await start(); await button("Add from Modrinth").click(); await pack.click(); await page.evaluate(()=>window.failImport=true);
  await button("Import").click(); await page.getByRole("alert").filter({hasText:"Import interrupted"}).waitFor();
  await button("Import").click(); await page.getByRole("heading",{name:"Downloads",exact:true}).first().waitFor();
  await start();
  await button("Import from file").click();
  await page.evaluate(() => {
    window.chosenFile = { path:"D:/Fixture/Forest.mrpack", name:"Forest pack", minecraft:"1.21.1", fabric:"0.16.9" };
    window.localPack = "local-pack";
  });
  await button("Choose file").click();
  await page.evaluate(() => window.chosenFile = null);
  await button("Change file").click();
  await button("Review").click();
  await page.getByText("Forest pack", {exact:true}).waitFor();
  await page.getByText("0.16.9", {exact:true}).waitFor();
  assert.equal(await page.evaluate(() => window.calls.some(c => c.cmd === "import_fabric_modpack")), false);
  await photo("creation-file-review");
  await button("Import").click();
  await page.getByRole("heading",{name:"Downloads",exact:true}).first().waitFor();
  assert.equal(await page.evaluate(() => window.calls.find(c => c.cmd === "import_fabric_modpack").args.packPath),"D:/Fixture/Forest.mrpack");
  await page.setViewportSize({width:900,height:680}); await start();
  await fits(button("Start from scratch")); await fits(button("Add from Modrinth")); await fits(button("Import from file"));
  await photo("new-instance-narrow");
}
async function checkWorkspaceTools() {
  const menuPage = async (menu, item) => {
    await page.getByRole("menuitem", { name:menu, exact:true }).click();
    await page.getByRole("menu", {name:menu, exact:true}).getByRole("menuitem",{name:item,exact:true}).click();
  };
  await open("Downloads");
  await button("Filter").click();
  const root = page.getByRole("menu",{name:"Filter downloads",exact:true});
  const type = root.getByRole("menuitem",{name:"Download type"});
  await type.click();
  const choices = page.getByRole("menu",{name:"Download type",exact:true});
  const left = await root.boundingBox(), right = await choices.boundingBox();
  assert.ok(right.x + right.width <= left.x, "Choices open left at the right window edge");
  assert.ok(Math.abs(right.y - (await type.boundingBox()).y) <= 1);
  await choices.getByRole("menuitemradio",{name:"Shaders",exact:true}).click();
  await button("Filter").click(); await type.press("ArrowRight");
  assert.equal(await choices.getByRole("menuitemradio",{name:"Shaders",exact:true}).getAttribute("aria-checked"),"true");
  await page.keyboard.press("Escape"); await root.getByRole("menuitem",{name:"Reset filters"}).click();
  await menuPage("View","Logs");
  const logs = page.getByRole("textbox",{name:"Search console output"});
  await logs.fill("example");
  assert.ok((await logs.boundingBox()).y < (await page.locator(".console-output").boundingBox()).y);
  await menuPage("View","Utilities");
  await page.getByRole("heading",{name:"Global File Sync"}).waitFor();
  assert.equal(await button("AutoTune").count(), 0);
  await menuPage("File","Import modpack");
  await page.getByRole("heading",{name:"Choose a modpack file"}).waitFor();
  await button("Back").click();
  await button("Start from scratch").waitFor();
}
async function checkDefaultAppearance() {
  for (const [part, hex] of Object.entries({background: "#0B0B0B", "icon rail": "#151515", "context sidebar": "#101010", text: "#FFFFFF"})) {
    assert.equal(await button("Choose " + part + " color").innerText(), hex);
  }
  assert.equal(await button("Dark").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Accent").innerText(), "Blue");
  assert.equal(await button("Interface size percentage").innerText(), "95%");
  assert.equal(await button("Compact").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Reduce motion").getAttribute("aria-pressed"), "false");
  assert.equal(await page.getByRole("slider", {name: "Divider strength"}).inputValue(), "13");
  assert.equal(await page.locator("main.content").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(11, 11, 11)");
}
try {
  await page.goto(url);
  await open("Settings"); await checkDefaultAppearance();
  // Exercise both legacy entry points with an actual IndexedDB preset and a saved launcher preference.
  await page.evaluate(async () => {
    const old = {memory: "8192 MB", gameDirectory: "D:/Minecraft/instances", customBackground: true, backgroundMode: "live", accent: "#123456", accentMode: "animated", accentIntensity: 100,
      accentStops: [{id:"start",color:"#da733e",position:0},{id:"end",color:"#7788ee",position:100}]};
    localStorage.setItem("bloom-settings",JSON.stringify(old));
    const request = indexedDB.open("bloom-appearance-presets",1);
    request.onupgradeneeded = () => request.result.createObjectStore("presets",{keyPath:"id"});
    await new Promise((resolve,reject) => {
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const db = request.result, tx = db.transaction("presets","readwrite");
        tx.objectStore("presets").put({id:"legacy",name:"Legacy",created:1,image:"data:image/webp;base64,bGVnYWN5",appearance:old});
        tx.oncomplete = () => { db.close(); resolve(); }; tx.onerror = () => reject(tx.error);
      };
    });
  });
  await page.reload();
  await open("Settings");
  await checkDefaultAppearance();
  const migrated = await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")));
  assert.equal(migrated.memory, "8192 MB");
  assert.equal(migrated.gameDirectory, "D:/Minecraft/instances");
  assert.equal(migrated.redesignAppearanceV1, true);
  await button("Appearance preset").click(); await button("Apply Legacy").click();
  assert.equal(await button("Choose custom accent color").innerText(), "#DA733E");
  assert.equal(await page.evaluate(() => "accentMode" in JSON.parse(localStorage.getItem("bloom-settings"))),false);
  await button("Reset appearance").click();
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const selectSection = name => button(name, sections).click();
  await selectSection("Background");
  assert.match(await button("Background source").innerText(), /Solid color/);
  assert.equal(await page.evaluate(() => "customBackground" in JSON.parse(localStorage.getItem("bloom-settings"))), false);
  assert.equal(await button("Sidebar", sections).count(), 0);
  await selectSection("Shortcuts");
  const homeShortcut = button("Shortcut for Home");
  await homeShortcut.dblclick();
  await page.keyboard.down("Control"); assert.equal(await homeShortcut.innerText(), "Ctrl + …");
  await page.keyboard.press("."); await page.keyboard.up("Control");
  assert.equal(await homeShortcut.innerText(), "Ctrl + .");
  await page.keyboard.press("Control+.");
  await page.getByRole("navigation", {name:"Main navigation"}).locator('[aria-label="Home"][aria-current="page"]').waitFor();
  await page.reload(); await open("Settings"); await selectSection("Shortcuts");
  assert.equal(await homeShortcut.innerText(), "Ctrl + .");
  await homeShortcut.dblclick(); await page.keyboard.press("Alt+2");
  await page.getByText("Already used by Instances.").waitFor();
  await page.keyboard.press("Escape"); await button("Reset shortcuts").click();
  assert.equal(await homeShortcut.innerText(), "Alt + 1");
  await selectSection("General");
  await button("Right Sidebar: Hidden").click(); await button("Custom Image").click();
  await page.getByLabel("Sidebar image file").setInputFiles({name:"sidebar.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64")});
  await page.getByAltText("Sidebar image preview").waitFor();
  await page.reload(); await open("Settings"); await selectSection("General");
  await page.getByAltText("Sidebar image preview").waitFor();
  await page.getByRole("group", {name:"Sidebar image controls"}).hover(); await button("Remove Image").click();
  await button("Choose Image").waitFor();
  await button("Right Sidebar: Custom Image").click(); await button("Hidden").click();
  await sections.getByRole("heading",{name:"System"}).waitFor();
  for (const label of await sections.getByRole("button").allTextContents()) {
    await selectSection(label);
    assert.equal(await page.locator(".settings-section:visible").count(), 1, label);
    const visibleSection = page.locator(".settings-section:visible");
    assert.equal(await visibleSection.locator(".section-subtitle, .setting-row > p").count(), 0);
    for (const row of await visibleSection.locator(".setting-row[data-setting-help]:visible").all()) {
      const help = row.locator(":scope > .info-tip-trigger");
      await help.hover();
      const tooltip = page.getByRole("tooltip").filter({hasText:await row.getAttribute("data-setting-help")});
      await tooltip.waitFor();
      await fits(tooltip);
      const bounds = await row.boundingBox(), icon = await help.boundingBox(), label = await row.locator(".setting-label").boundingBox();
      const title = await row.locator(".setting-label b").boundingBox();
      const labelStyle = await row.locator(".setting-label b").evaluate(el => getComputedStyle(el).fontSize);
      assert.equal(labelStyle, "15px");
      assert.ok(title.x - label.x < (await row.locator(".settings-avatar").count() ? 70 : 2), "Names start at the left of their label column");
      const control = await row.locator(":scope > :nth-child(2)").boundingBox();
      assert.ok(control.x >= title.x + title.width && control.x + control.width <= icon.x + 1, "Controls fit between the label and help");
      assert.ok(bounds.x + bounds.width - icon.x - icon.width < 30, "Help must sit at the right edge");
      assert.ok(Math.abs((label.y + label.height / 2) - (icon.y + icon.height / 2)) < 2, "Label and help must be centered");
      await page.keyboard.press("Escape"); await tooltip.waitFor({state:"hidden"});
    }
    for (const control of await page.locator(".settings-section:visible .select-trigger:enabled:visible").all()) {
      await control.click();
      await fits(page.locator(".select-menu-portal:visible").last());
      await page.keyboard.press("Escape");
      assert.equal(await control.getAttribute("aria-expanded"), "false");
    }
  }
  await selectSection("Storage");
  const storage = page.locator(".storage-settings");
  await storage.getByText("450 cached items").waitFor();
  assert.ok((await storage.locator(".storage-amount strong").evaluate(el => getComputedStyle(el).backgroundImage)).includes("gradient"));
  await photo("storage");
  await button("Change folder").click(); await button("About Cache folder").focus(); await page.getByRole("tooltip").filter({hasText:"D:/Delight/Cache"}).waitFor(); await page.keyboard.press("Escape");
  await page.getByRole("slider",{name:"Cache capacity"}).press("ArrowRight");
  await page.waitForFunction(() => window.calls.some(c => c.cmd === "save_client_cache_settings" && c.args.directory === "D:/Delight/Cache" && c.args.capacityBytes === 2.5 * 1073741824));
  await button("Clear cache", storage).click(); await storage.getByText("Cache cleared.").waitFor();
  assert.ok(await button("Clear cache", storage).isDisabled());
  await selectSection("Accounts");
  const saved = page.getByRole("list", {name:"Saved Minecraft accounts"});
  await saved.getByText("Parks", {exact:true}).waitFor();
  const portrait = button("Change picture");
  const accountList = await saved.boundingBox(), picture = await portrait.boundingBox();
  const sidebar = await page.locator(".desktop-context").boundingBox();
  const column = await page.locator(".accounts-picture").boundingBox();
  assert.equal(picture.width, 152);
  assert.equal(picture.height, picture.width);
  assert.equal(await page.locator(".accounts-picture h3").count(), 0);
  const leftGap = picture.x - (sidebar.x + sidebar.width);
  const rightGap = column.x + column.width - 1 - (picture.x + picture.width);
  assert.ok(Math.abs(leftGap - rightGap) < 1, "Portrait must have equal side margins");
  assert.ok(Math.abs(accountList.x - (column.x + column.width) - rightGap) < 1, "List and portrait have matching divider insets");
  assert.equal(await page.locator(".accounts-library h3").count(), 0);
  const skinImages = saved.locator(".account-skin-portrait img");
  await skinImages.nth(1).waitFor();
  const skins = await skinImages.evaluateAll(async imgs => {
    await Promise.all(imgs.map(img => img.decode()));
    return imgs.map(img => [img.naturalWidth, img.naturalHeight, img.src]);
  });
  assert.equal(skins.length, 2);
  assert.ok(skins.every(([w,h]) => w === 192 && h === 192));
  assert.notEqual(skins[0][2], skins[1][2], "Saved accounts show their individual rendered skins");
  const add = button("Add Minecraft account");
  assert.ok((await add.boundingBox()).y >= accountList.y + accountList.height + 16, "Add account sits below the list");
  await photo("accounts");
  await page.setViewportSize({ width: 900, height: 680 });
  assert.ok((await saved.boundingBox()).y > (await portrait.boundingBox()).y + picture.height, "Narrow settings stack the two sections");
  await add.scrollIntoViewIfNeeded(); await fits(add);
  await photo("accounts-narrow");
  await page.setViewportSize({ width: 1280, height: 800 });
  await button("Switch to Alex",saved).click(); await button("Cancel",saved).click();
  assert.equal(await saved.locator("li").filter({hasText:"Parks"}).getByText("Active").count(),1);
  await button("Switch to Alex",saved).click(); await button("Confirm switch",saved).click();
  await saved.locator("li").filter({hasText:"Alex"}).getByText("Active").waitFor();
  await button("Switch to Parks",saved).click(); await button("Confirm switch",saved).click();
  await saved.locator("li").filter({hasText:"Parks"}).getByText("Active").waitFor();
  const filePicker=page.waitForEvent("filechooser"); await button("Change picture").click();
  await (await filePicker).setFiles({name:"sample.png",mimeType:"image/png",buffer:Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=","base64")});
  await page.getByText("Profile picture updated for every account.").waitFor();
  await button("Add Minecraft account").click();
  const signin=page.getByRole("group",{name:"Microsoft sign-in"}); await signin.getByText("TEST-CODE").waitFor();
  await button("Close",page.locator(".settings-account-connect")).click();
  await selectSection("Appearance");
  await button("About Delight").click(); await page.getByRole("heading", { name: "About Delight" }).waitFor(); await button("Visit website").click();
  await button("Help & feedback").click(); await selectSection("Appearance");
  await photo("settings-appearance");
  const theme = value => page.waitForFunction(v => document.documentElement.dataset.theme === v, value);
  await button("Light").click(); await theme("light");
  await button("System").click(); await theme("oled");
  await page.emulateMedia({ colorScheme: "light" }); await theme("light");
  await page.emulateMedia({ colorScheme: "dark" }); await theme("oled");
  await button("Dark").click();
  const setColor = async (part, hex) => {
    await button("Choose " + part.toLowerCase() + " color").click();
    const dialog = page.getByRole("dialog",{name:part + " color",exact:true});
    await dialog.getByRole("textbox").fill(hex);
    await button("Apply color",dialog).click();
  };
  assert.equal(await page.locator(".desktop-context").evaluate(el => getComputedStyle(el).backgroundColor), "rgb(16, 16, 16)");
  await setColor("Background", "#202830"); await setColor("Text", "#e7ebef");
  await button("Interface font").click(); await button("Verdana").click();
  const railSurface = () => page.locator(".desktop-rail").evaluate(el => getComputedStyle(el).backgroundColor);
  await setColor("Icon rail", "#41454a");
  assert.equal(await railSurface(), "rgb(65, 69, 74)");
  await setColor("Context sidebar", "#353941");
  assert.equal(await railSurface(), "rgb(65, 69, 74)");
  const sidebarSurface = () => page.locator(".desktop-context").evaluate(el => getComputedStyle(el).backgroundColor);
  assert.equal(await sidebarSurface(), "rgb(53, 57, 65)");
  const dividers = page.getByRole("slider", {name: "Divider strength"});
  const dividerColor = () => page.locator(".appearance-group-heading").first().evaluate(el => getComputedStyle(el).borderBottomColor);
  await dividers.press("Home"); const faint = await dividerColor(); await dividers.press("End");
  assert.notEqual(await dividerColor(), faint);
  async function appearanceStyle() {
    return page.locator("main.content").evaluate(el => {
      const label = el.querySelector('[data-settings-section="Appearance"] .setting-label b');
      return [getComputedStyle(el).backgroundColor, getComputedStyle(label).color, getComputedStyle(label).fontFamily.split(",")[0]];
    });
  }
  assert.deepEqual(await appearanceStyle(), ["rgb(32, 40, 48)", "rgb(231, 235, 239)", "Verdana"]);
  await page.reload(); await open("Settings");
  assert.deepEqual(await appearanceStyle(), ["rgb(32, 40, 48)", "rgb(231, 235, 239)", "Verdana"]);
  assert.equal(await dividers.inputValue(),"100"); assert.equal(await sidebarSurface(),"rgb(53, 57, 65)");
  await button("Light").click(); await theme("light");
  assert.notEqual(await sidebarSurface(),"rgb(53, 57, 65)");
  assert.notEqual((await appearanceStyle())[0], "rgb(32, 40, 48)");
  await button("Reset appearance").click(); await theme("oled");
  const chooseAccent = async name => { await button("Accent").click(); await button(name, page.getByRole("dialog",{name:"Accent",exact:true})).click(); };
  for (const name of ["Purple", "Pink", "Red", "Orange", "Green", "Teal", "Blue"]) {
    await chooseAccent(name); assert.equal(await button("Accent").innerText(), name);
    assert.equal(await button("Choose custom accent color").count(), 0);
  }
  await chooseAccent("Custom");
  await button("Choose custom accent color").click();
  const colorDialog = page.getByRole("dialog", {name: "Custom accent color"});
  await fits(colorDialog);
  assert.equal(await colorDialog.getByRole("button").allTextContents().then(labels => labels.join()), "Apply color");
  const saturationField = colorDialog.getByRole("slider", {name: "Saturation and brightness"});
  const hue = colorDialog.getByRole("slider", {name:"Hue", exact:true});
  const hex = colorDialog.getByRole("textbox",{name:"Hex color"});
  await hex.fill("#00FF00"); await hue.press("Home"); assert.equal(await hex.inputValue(), "#FF0000");
  await saturationField.press("ArrowDown"); assert.notEqual(await hex.inputValue(), "#FF0000");
  await hex.fill("#XY"); assert.ok(await button("Apply color",colorDialog).isDisabled());
  await hex.fill("#E08D57"); await photo("appearance-color-picker"); await button("Apply color",colorDialog).click();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).accent), "#e08d57");
  await button("Choose custom accent color").click(); await hex.fill("#FFFFFF"); await page.keyboard.press("Escape");
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).accent), "#e08d57");
  assert.ok(await button("Choose custom accent color").evaluate(el => el === document.activeElement));
  await chooseAccent("Blue"); await chooseAccent("Custom");
  assert.equal(await button("Choose custom accent color").innerText(), "#E08D57");
  await page.reload(); await open("Settings"); assert.equal(await button("Accent").innerText(), "Custom");
  await photo("appearance-accent-custom"); await chooseAccent("Blue");
  for (const box of [button("Dark").locator(".theme-preview")]) {
    const mark = box.locator("svg");
    const [outer, inner] = await Promise.all([box.boundingBox(), mark.boundingBox()]);
    assert.ok(Math.abs(outer.x + outer.width / 2 - inner.x - inner.width / 2) < 1 && Math.abs(outer.y + outer.height / 2 - inner.y - inner.height / 2) < 1, "The checkmark is centered on both axes");
  }
  const current = sections.locator("button[aria-current]");
  assert.deepEqual(await current.evaluate(el => [getComputedStyle(el).boxShadow, getComputedStyle(el,"::before").content]), ["none","none"]);
  await button("Interface font").click();
  for (const name of ["Bahnschrift","Calibri","Consolas","Georgia","Tahoma","Trebuchet MS"]) await button(name).waitFor();
  await button("Georgia").click();
  assert.equal((await appearanceStyle())[2], "Georgia");
  assert.equal(await button("Animated gradient accent").count(),0);
  const size = button("Interface size percentage");
  const zoomCalls=() => page.evaluate(() => window.calls.filter(c => c.cmd.includes("set_webview_zoom")).length);
  const slider=page.getByRole("slider",{name:"Interface size",exact:true});
  const bounds=await slider.boundingBox(), before=await zoomCalls();
  await page.mouse.move(bounds.x + bounds.width * .3, bounds.y + bounds.height / 2); await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width - 1, bounds.y + bounds.height / 2, {steps:14});
  assert.equal(await zoomCalls(),before); assert.equal(await size.innerText(),"125%");
  await page.mouse.up(); await page.waitForFunction(() => window.calls.filter(c => c.cmd.includes("set_webview_zoom")).at(-1)?.args.value === 1.25);
  assert.equal(await zoomCalls(),before+1);
  await button("Reset appearance").click();
  await size.focus(); await page.keyboard.press("ArrowDown"); await page.waitForFunction(() => document.activeElement?.textContent === "95%");
  await photo("settings-dropdown"); await fits(page.locator(".select-menu-portal"));
  await button("110%").click();
  await page.waitForFunction(() => window.calls.some(c => c.cmd.includes("set_webview_zoom") && c.args.value === 1.1));
  await button("Compact").click(); await button("Reduce motion").click();
  await page.reload(); await open("Settings");
  assert.equal(await size.innerText(), "110%");
  assert.equal(await button("Compact").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Reduce motion").getAttribute("aria-pressed"), "true");
  await page.getByLabel("Interface size", {exact:true}).press("ArrowRight");
  assert.equal(await size.innerText(), "115%");
  await page.getByText("More appearance options", {exact:true}).click(); await page.getByRole("slider", {name:"Button pop duration", exact:true}).press("End");
  const preset = button("Appearance preset");
  await preset.click(); await button("Save new").click(); await page.getByRole("textbox", {name:"Appearance name"}).fill("Reading"); await button("Save").click();
  await page.waitForFunction(() => document.querySelector('[aria-label="Appearance preset"]')?.textContent === "Reading");
  await button("Comfortable").click(); await preset.click(); await button("Apply Reading").click();
  assert.equal(await button("Compact").getAttribute("aria-pressed"),"true");
  await preset.click(); await button("Remove Reading").click(); await button("Remove",page.locator(".appearance-preset-editor")).click();
  await button("Reset appearance").click(); await checkDefaultAppearance();
  assert.equal(await button("Compact").getAttribute("aria-pressed"), "true");
  assert.equal(await button("Reduce motion").getAttribute("aria-pressed"), "false");
  const search = page.getByRole("searchbox", {name:"Search settings"});
  await search.fill("can run at once"); await page.locator(".settings-search-results button").first().click();
  assert.equal(await page.locator(".settings-section:visible").getAttribute("data-settings-section"), "Downloads");
  await page.setViewportSize({ width: 900, height: 680 });
  await selectSection("Appearance"); await size.click(); await fits(page.locator(".select-menu-portal")); await page.keyboard.press("Escape");
  await photo("settings-minimum");
  const sizeHelp = button("About Interface size");
  await sizeHelp.focus(); await page.getByRole("tooltip").filter({hasText:"Adjust the size of text and controls."}).waitFor();
  await fits(page.getByRole("tooltip")); await photo("settings-info"); await page.keyboard.press("Escape");
  await open("Home");
  const choose = () => page.getByRole("button", { name: /^Choose instance:/ });
  const news = page.getByRole("region",{name:"News"});
  await news.getByRole("button",{name:"Delight",exact:true}).click();
  await news.getByRole("button",{name:/Delight Client release notes/}).click();
  await news.getByRole("button",{name:"Minecraft",exact:true}).click();
  await page.setViewportSize({width:1280,height:800}); await page.locator("main.content").evaluate(el => el.scrollTop=0);
  await photo("home-launch-news");
  await checkSquareIcon(page.locator(".home-instance-art img"));
  await choose().click(); const picker = page.getByRole("dialog", { name: "Choose instance" });
  await fits(picker);
  for (const image of await picker.locator("img").all()) await checkSquareIcon(image);
  const pickerBounds = await picker.boundingBox(), barBounds = await choose().boundingBox();
  assert.ok(pickerBounds.y + pickerBounds.height <= barBounds.y || pickerBounds.y >= barBounds.y + barBounds.height);
  await photo("instance-picker");
  assert.equal(await picker.getByRole("textbox").count(),0);
  assert.equal(await picker.getByRole("button",{name:"New instance"}).count(),0);
  await picker.getByRole("button",{name:"Creative",exact:true}).click();
  assert.match(await choose().getAttribute("aria-label"), /Creative/);
  await checkSquareIcon(page.locator(".home-instance-art img"));
  await open("Instances"); await button("New instance").click();
  await checkInstanceCreation();
  await checkWorkspaceTools();
  await button("Account: Parks").click();
  const account = page.getByRole("menu", { name: "Account menu" });
  await fits(account); await photo("account-menu");
  await account.getByText("Switch account").click(); await account.getByRole("menuitem", { name: "Alex", exact: true }).click();
  await button("Account: Alex").click(); await account.getByText("Add account").click();
  await page.getByRole("group",{name:"Microsoft sign-in"}).waitFor();
  await open("Instances"); await page.locator(".desktop-instance-link").getByRole("button", {name:"Meadow", exact:true}).click();
  assert.equal(await page.getByText("Ready to play", {exact:true}).count(),0);
  const installedSearch = page.getByRole("textbox", {name: "Search installed mods"});
  await installedSearch.fill("missing test mod");
  const emptyMods = page.locator(".content-empty");
  await emptyMods.getByText("No mods match “missing test mod”.", {exact: true}).waitFor();
  const emptyStyle = await emptyMods.evaluate(el => {
    const style = getComputedStyle(el);
    return [style.backgroundColor, style.backgroundImage, style.boxShadow];
  });
  assert.deepEqual(emptyStyle, ["rgba(0, 0, 0, 0)", "none", "none"]);
  assert.ok((await emptyMods.boundingBox()).height < (await page.locator(".content-list").boundingBox()).height / 2);
  await button("Clear search", emptyMods).click();
  assert.equal(await installedSearch.inputValue(), "");
  const tabs = page.getByRole("tablist"); assert.ok((await tabs.getByRole("tab").allTextContents()).every(label => !/\d/.test(label)));
  const previous = page.locator(".installed-content-item b").first(); await previous.waitFor(); const old = await previous.innerText();
  await button("Page 2").click(); assert.notEqual(await previous.innerText(), old); await button("Previous page").click(); assert.equal(await previous.innerText(), old);
  for (const trigger of [button("Actions for Meadow"), page.locator(".installed-content-item .content-dots").first()]) {
    await trigger.click();
    assert.equal(await page.locator(".select-menu-portal:visible").evaluate(el=>getComputedStyle(el,"::before").content),"none");
    await page.keyboard.press("Escape");
  }
  await button("Open instance folder").click(); assert.ok(await page.evaluate(() => window.calls.some(c => c.cmd === "open_instance_folder" && c.args.instanceId === "0")));
  const rename = button("Rename Meadow"); const nameBox = await rename.boundingBox();
  await rename.dblclick(); const field = page.getByRole("textbox", {name: "Instance name"});
  const editBox = await field.boundingBox(); assert.ok(Math.abs(editBox.x - nameBox.x) < 2 && Math.abs(editBox.y - nameBox.y) < 2, JSON.stringify({nameBox,editBox}));
  assert.deepEqual(await field.evaluate(el => [el.selectionStart, el.selectionEnd]),[6,6]);
  await field.press("Backspace"); await field.press("Enter"); await button("Rename Meado").waitFor();
  await button("Add Mods").click();
  const installedMod = page.locator(".catalog-result").filter({has:button("Open details for Mod Menu")});
  const availableMod = page.locator(".catalog-result").filter({has:button("Open details for Mod Menu Command")});
  await installedMod.getByText("Installed",{exact:true}).waitFor();
  assert.equal(await button("Install Mod Menu Command",availableMod).isEnabled(),true);
  assert.equal(await button("Mod Menu is installed",installedMod).isDisabled(),true);
  await button("View Mod Menu on Modrinth",installedMod).click();
  for (const row of [installedMod,availableMod]) {
    const cells = await row.locator(":scope > *").evaluateAll(elements => elements.map(el => {const r=el.getBoundingClientRect();return [r.left,r.right]}));
    assert.ok(cells.every(([left],i) => !i || left >= cells[i-1][1] - 1), "Compact catalog columns overlap");
  }
  await button("Back to installed mods").click();
  for (const [tab, color] of [["Resource packs","orange"], ["Shaders","skyblue"]]) {
    await tabs.getByRole("tab", {name: new RegExp(tab,"i")}).click();
    const art = page.locator(".installed-content-item .content-icon img"); await art.first().waitFor();
    await page.waitForFunction(color => [...document.querySelectorAll(".installed-content-item img")].some(img => img.naturalWidth && img.src.includes(color)), color);
    assert.ok(await art.last().evaluate(el => el.src.includes("purple") && el.naturalWidth));
    await page.getByRole("button", {name: new RegExp("^Add " + tab, "i")}).click();
    await page.locator(".catalog-item img").first().evaluate(img => img.decode());
    await page.getByRole("button", {name:/Back to installed/i}).click();
  }
  assert.deepEqual(await page.evaluate(() => window.calls.filter(call => call.cmd.endsWith("_custom_background"))), []);
  assert.deepEqual(errors,[]);
  console.log("Passed Settings section navigation and all enabled selectors, theme/OS changes, accent, native zoom request, persistence, reset, search, minimum viewport, account actions, searchable instance picker, pagination, inline caret and pack artwork fallbacks.");
} finally { await browser.close(); }
