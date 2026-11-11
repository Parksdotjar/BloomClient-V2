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
  window.folderTest = { renameFail: false, calls: [], failSave: false, failLoad: false, delaySave: false, releaseSave: null, instances };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.folderTest.calls.push({ command, args });
      if (command === "list_instances") return instances;
      if (command === "list_instance_content") return Array.from({length:80}, (_, i) => ({name:`Mod ${i}`,fileName:`mod-${i}.jar`,version:"1",enabled:true,size:1024,loader:"Fabric"}));
      if (command === "rename_instance") { if (window.folderTest.renameFail) throw "Could not save name"; const item=instances.find(i=>i.id===args.instanceId); item.name=args.name; return {...item}; }
      if (command === "export_instance") return null;
      if (command === "duplicate_instance") { const copy={...instances.find(i=>i.id===args.instanceId),id:"copy",name:"Meadow Copy"}; instances.push(copy); return copy; }
      if (command === "delete_instance") { instances.splice(instances.findIndex(i=>i.id===args.instanceId),1); return null; }
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

const nav=()=>page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Instances",exact:true}).click();
const card=name=>page.locator(".instance-library-card").filter({has:page.getByRole("heading",{name,exact:true})});
const calls=cmd=>page.evaluate(cmd=>window.folderTest.calls.filter(c=>c.command===cmd),cmd);
const edit=()=>page.getByRole("textbox",{name:"Instance name",exact:true});
const settle=()=>page.waitForTimeout(400);
const shots=process.env.CONTROLS_SCREENSHOTS;
const shot=async name=>{if(shots){await mkdir(shots,{recursive:true});await page.screenshot({path:`${shots}/${name}.png`});}};
try {
 await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });await nav();await card("Meadow").waitFor();await settle();
 assert.equal(await card("Meadow").locator(".library-card-copy p,.library-card-copy small,.library-folder").count(),3);
 assert.equal(await card("Meadow").locator(".library-card-actions .library-more").count(),1);
 await card("Meadow").getByRole("button",{name:"Open Meadow folder",exact:true}).click();assert.equal((await calls("open_instance_folder")).at(-1).args.instanceId,"0");
 await shot("library");
 await card("Meadow").getByRole("button",{name:"Rename Meadow",exact:true}).click();
 await edit().fill("Cancel me");await edit().press("Escape");
 assert.equal((await calls("rename_instance")).length,0);await card("Meadow").waitFor();
 await page.getByRole("button",{name:"Actions for Meadow",exact:true}).click();
 await page.getByRole("button",{name:"Rename",exact:true}).click();
 await edit().fill(" ");await edit().press("Enter");await page.getByRole("alert").filter({hasText:"Enter an instance name"}).waitFor();
 await page.evaluate(()=>window.folderTest.renameFail=true);await edit().fill("New name");await edit().press("Enter");
 await page.getByRole("alert").filter({hasText:"Could not save name"}).waitFor();
 assert.equal(await page.evaluate(()=>window.folderTest.instances[0].name),"Meadow");
 await page.evaluate(()=>window.folderTest.renameFail=false);await edit().press("Enter");await card("New name").waitFor();
 const renamed=(await calls("rename_instance")).at(-1);assert.deepEqual(renamed.args,{instanceId:"0",name:"New name"});
 await page.getByRole("button",{name:"Actions for New name",exact:true}).click();await page.getByRole("button",{name:"Export ZIP",exact:true}).click();await settle();assert.equal((await calls("export_instance")).length,1);
 await card("New name").getByRole("button",{name:"Open New name",exact:true}).click();
 await page.locator(".instance-hero-actions .instance-play").waitFor();await settle();
 assert.equal(await page.locator(".instance-launch-dock").count(),0);
 await page.locator(".instance-identity").getByRole("button",{name:"Rename New name",exact:true}).click();await edit().fill("Meadow");await edit().press("Enter");await page.locator(".instance-identity").getByRole("heading",{name:"Meadow",exact:true}).waitFor();
 await shot("restored-header");
 await page.getByRole("button",{name:"Actions for Meadow",exact:true}).click();await page.getByRole("button",{name:"Pop out Play controls",exact:true}).click();
 const floating=page.locator(".floating-instance-player");await floating.waitFor();await settle();
 assert.equal(await page.locator(".instance-hero-actions .instance-play").count(),1);
 const original=await floating.boundingBox();
 await page.mouse.move(original.x+original.width/2,original.y+original.height/2);await page.mouse.down();await page.mouse.move(original.x+original.width/2+45,original.y+original.height/2-230,{steps:15});await page.mouse.up();await settle();
 const moved=await floating.boundingBox();assert.ok(moved.y<original.y-200);assert.equal((await calls("launch_minecraft")).length,0);
 await shot("floating-expanded");await nav();await settle();const across=await floating.boundingBox();assert.ok(Math.abs(across.y-moved.y)<1);
 await card("Vanilla").getByRole("button",{name:"Open Vanilla",exact:true}).click();await settle();
 assert.equal(await floating.getAttribute("aria-label"),"Floating Play controls for Meadow");
 const resize=page.getByRole("separator",{name:"Resize floating controls"});const r=await resize.boundingBox();
 await page.mouse.move(r.x+r.width/2,r.y+r.height/2);await page.mouse.down();await page.mouse.move(r.x-400,r.y+r.height/2,{steps:20});await page.mouse.up();await settle();
 assert.ok(Math.abs((await floating.boundingBox()).width-56)<1);await shot("floating-icon");
 await resize.focus();await resize.press("End");await settle();assert.ok(Math.abs((await floating.boundingBox()).width-360)<1);
 const beforeCancel=await floating.boundingBox();await page.mouse.move(beforeCancel.x+170,beforeCancel.y+30);await page.mouse.down();await page.mouse.move(beforeCancel.x+200,beforeCancel.y+100,{steps:5});await page.keyboard.press("Escape");await page.mouse.up();await settle();assert.ok(Math.abs((await floating.boundingBox()).y-beforeCancel.y)<1);
 const moveHandle=page.getByRole("button",{name:"Move floating controls"});await moveHandle.focus();await moveHandle.press("ArrowUp");await settle();assert.ok((await floating.boundingBox()).y<beforeCancel.y-9);
 await page.setViewportSize({width:900,height:680});await settle();const small=await floating.boundingBox();const main=await page.locator("main.content").boundingBox();assert.ok(small.x>=main.x && small.x+small.width<=main.x+main.width && small.y+small.height<=680);await shot("floating-minimum");
 await page.emulateMedia({reducedMotion:"reduce"});await resize.focus();await resize.press("Home");assert.equal(await floating.evaluate(el=>el.getBoundingClientRect().width),56);
 await page.evaluate(()=>{document.documentElement.dataset.theme="light";document.documentElement.dataset.animations="off";});await shot("floating-light");
 await floating.hover();await page.getByRole("button",{name:"Put away floating controls",exact:true}).click();await floating.waitFor({state:"detached"});
 assert.equal(await page.locator(".instance-hero-actions .instance-play").count(),1);
 await page.getByRole("button",{name:"Actions for Vanilla",exact:true}).click();await page.getByRole("button",{name:"Pop out Play controls",exact:true}).click();await floating.waitFor();assert.equal(Math.round((await floating.boundingBox()).width),56);
 await nav();await floating.getByRole("button",{name:"Play Vanilla",exact:true}).click();await settle();assert.equal((await calls("launch_minecraft")).at(-1).args.instanceId,"1");assert.equal(await floating.getByRole("button",{name:"Play Vanilla",exact:true}).isDisabled(),true);
 // Reload clears the session-only popped instance; placement remains a preference.
 await page.reload();await nav();await card("Meadow").waitFor();assert.equal(await floating.count(),0);
 await nav();await page.getByRole("button",{name:"Actions for Meadow",exact:true}).click();await page.getByRole("button",{name:"Duplicate",exact:true}).click();await page.locator(".instance-identity").getByRole("heading",{name:"Meadow Copy",exact:true}).waitFor();assert.equal((await calls("duplicate_instance")).length,1);
 await nav();await page.getByRole("button",{name:"Actions for Meadow Copy",exact:true}).click();await page.getByRole("button",{name:"Delete instance",exact:true}).click();assert.equal((await calls("delete_instance")).length,0);await page.getByRole("button",{name:"Confirm delete",exact:true}).click();await settle();assert.equal((await calls("delete_instance")).length,1);
 assert.deepEqual(errors,[]);console.log("Instance controls: rename/error/cancel, duplicate/export/delete, floating drag/resize/Escape/keyboard, cross-page target, busy launch, saved size, minimum window, light and reduced motion passed.");
} catch(error) { await shot("failure"); console.log(await page.locator(".instance-workspace,.instance-hero-panel,.instance-tabbar,.instance-manager,.content-toolbar,.content-search,.content-pagination,.instance-content-list-shell").evaluateAll(nodes=>nodes.map(n=>({class:n.className,y:n.getBoundingClientRect().y,height:n.getBoundingClientRect().height})))); throw error; } finally {await browser.close();}
