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
  localStorage.setItem("bloom-settings", JSON.stringify({ modChecksOnStartup: false, theme: "oled", accent: "#f24f54", animations: true, buttonPressDuration: 0, ...JSON.parse(localStorage.getItem("loader-test-prefs")||"{}") }));
  const art = (color, letter) => "data:image/svg+xml," + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="${color}"/><text x="50" y="68" text-anchor="middle" fill="white" font-family="sans-serif" font-size="48" font-weight="bold">${letter}</text></svg>`);
  const instances = JSON.parse(localStorage.getItem("loader-test-instances") || "null") || ["Meadow", "Vanilla", "Creative", "Adventure"].map((name, i) => ({ id: String(i), name, loader: i === 1 ? "Vanilla" : "Fabric", loaderVersion: i === 0 ? "0.18.4" : null, version: "1.21.1", directory: `C:/Bloom/instances/${name}`, java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true, icon: i === 3 ? undefined : art(["#55795e", "#a18350", "#677fa6"][i], name[0]) }));
  window.folderTest = { metadataFail: false, metadataDelay: false, releaseMetadata: null, saveDelay: false, releaseSettings: null, running: false, launchedVersions: [], renameFail: false, calls: [], failSave: false, failLoad: false, delaySave: false, releaseSave: null, instances };
  let next = 1;
  const callbacks = new Map();
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(fn) { const id=next++; callbacks.set(id,fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.folderTest.calls.push({ command, args });
      if (command === "check_mod_maintenance") {
        const version = instances.find(item => item.id === args.instanceId).loaderVersion;
        if (window.folderTest.holdScan) await new Promise(resolve => window.folderTest.releaseScan = resolve);
        (window.folderTest.scannedVersions ??= []).push(version);
        return { updates: [], repairsAvailable: false, dependencyIssues: [], issues: [], complete: true };
      }
      if (command === "list_instances") return instances.map(item => ({...item}));
      if (command === "cosmetics_request") return {items:[]};
      if (command === "list_instance_fabric_loaders") {
        if(window.folderTest.metadataDelay) await new Promise(resolve=>window.folderTest.releaseMetadata=resolve);
        if(window.folderTest.metadataFail) throw "Could not load Fabric versions. Check your connection and retry.";
        return {currentVersion:instances.find(item=>item.id===args.instanceId).loaderVersion || "0.18.4", versions:[{version:"0.21.0-beta.1",stable:false},{version:"0.20.1",stable:true},{version:"0.19.5",stable:true},{version:"0.18.4",stable:true}]};
      }
      if (command === "update_instance_settings") {
        if(window.folderTest.saveDelay) await new Promise(resolve=>window.folderTest.releaseSettings=resolve);
        if(window.folderTest.failSave) throw "Could not save settings. Try again.";
        const item=instances.find(item=>item.id===args.instanceId);
        item.name=args.name;item.memory=args.memory;item.jvmArguments=args.jvmArguments;
        if(args.loaderVersion) item.loaderVersion=args.loaderVersion;
        localStorage.setItem("loader-test-instances",JSON.stringify(instances));
        return {...item};
      }
      if (command === "launch_minecraft") {window.folderTest.launchedVersions.push(instances.find(item=>item.id===args.instanceId).loaderVersion);return null;}
      if (command === "get_minecraft_process_running") return window.folderTest.running;

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
      if (command === "get_saved_minecraft_profile") return {id:"test-profile",name:"Test"};
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "get_minecraft_releases") return [{ id: "1.21.1", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations"].includes(command)) return [];
      if (command === "plugin:event|listen") {
        if (args.event === "instance-loader-resolved") window.folderTest.emitLoader = payload => callbacks.get(args.handler)?.({ event: args.event, payload });
        return next++;
      }
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});

const nav=()=>page.getByRole('navigation',{name:'Main navigation'}).getByRole('button',{name:'Instances',exact:true}).click();
const open=async(name='Meadow')=>{await nav();await page.getByRole('navigation',{name:'Your instances'}).getByRole('button',{name,exact:true}).click();await page.getByRole('tab',{name:'Instance settings',exact:true}).click();await page.getByRole('heading',{name:'Instance settings',exact:true}).waitFor();};
const selector=page.getByRole('button',{name:'Fabric Loader version',exact:true});
const save=page.getByRole('button',{name:'Save changes',exact:true});
const calls=command=>page.evaluate(command=>window.folderTest.calls.filter(call=>call.command===command),command);
const wait=async(fn)=>{await page.waitForFunction(fn);};
const pick=async(label)=>{await selector.click();await page.locator('.select-menu-portal').getByRole('button',{name:label,exact:true}).click();};
const saveDone=async()=>{await save.click();await page.waitForFunction(()=>!document.querySelector('.instance-preferences-save').disabled);};
const shot=async(name)=>{await page.screenshot({path:`logs/fabric-loader-settings/${name}.png`});};
try {
 await mkdir('logs/fabric-loader-settings',{recursive:true});
 await page.goto(url);await open();await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);
 assert.match(await selector.innerText(),/0\.18\.4/);const beforeStyle=await page.addStyleTag({content:'.instance-fabric-loader{display:none!important}'});await shot('before-settings');await beforeStyle.evaluate(node=>node.remove());await shot('settings');
 assert.deepEqual(await save.evaluate(el => {
   const css = getComputedStyle(el);
   return [css.backgroundImage, css.boxShadow, css.borderTopWidth];
 }), ['none', 'none', '1px'], 'Save uses the flat outlined launcher control');
 // Draft changes are not persisted until Save, and all other settings travel through the same command.
 await pick('0.20.1 (latest stable)');assert.equal((await calls('update_instance_settings')).length,0);
 await page.getByRole('textbox',{name:'Instance name',exact:true}).fill('Meadow');
 await page.evaluate(()=>window.folderTest.saveDelay=true);await save.click();await wait(()=>typeof window.folderTest.releaseSettings==='function');
 assert.equal(await selector.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Saving…',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{window.folderTest.saveDelay=false;window.folderTest.releaseSettings();});await page.waitForFunction(()=>!document.querySelector('.instance-preferences-save').disabled);
 await page.waitForFunction(()=>window.folderTest.calls.some(c=>c.command==='check_mod_maintenance'));
 assert.deepEqual((await calls('check_mod_maintenance')).map(c=>c.args.instanceId),['0'], 'one check for the instance whose loader changed with startup checks off');
 await saveDone();
 assert.equal((await calls('check_mod_maintenance')).length,1,'saving the same runtime does not recheck');
 assert.equal((await calls('update_instance_settings')).find(c=>c.args.loaderVersion)?.args.loaderVersion,'0.20.1');
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('loader-test-instances'))[0].loaderVersion),'0.20.1');
 await page.evaluate(()=>window.folderTest.holdScan=true);
 await pick('0.19.5');await saveDone();await wait(()=>typeof window.folderTest.releaseScan==='function');
 await pick('0.18.4');await saveDone();await pick('0.20.1 (latest stable)');await saveDone();
 assert.equal((await calls('check_mod_maintenance')).length,2,'rapid saves share the in-flight scan');
 await page.evaluate(()=>{window.folderTest.holdScan=false;window.folderTest.releaseScan()});
 await wait(()=>window.folderTest.scannedVersions.length===3);
 assert.deepEqual(await page.evaluate(()=>window.folderTest.scannedVersions),['0.20.1','0.19.5','0.20.1']);
 await page.reload();await open();await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);assert.match(await selector.innerText(),/0\.20\.1/);
 // Saving unrelated edits omits the optional loader field, preserving pins even without metadata.
 await saveDone();assert.equal('loaderVersion' in (await calls('update_instance_settings')).at(-1).args,false);
 await page.locator('.instance-hero-actions .instance-play').click();await wait(()=>window.folderTest.launchedVersions.length===1);assert.equal(await page.evaluate(()=>window.folderTest.launchedVersions[0]),'0.20.1');
 await page.reload();await open();await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);
 await pick('0.18.4');await page.evaluate(()=>window.folderTest.failSave=true);await saveDone();
 assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('loader-test-instances'))[0].loaderVersion),'0.20.1');assert.match(await selector.innerText(),/0\.18\.4/);
 await page.evaluate(()=>window.folderTest.failSave=false);await saveDone();assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem('loader-test-instances'))[0].loaderVersion),'0.18.4');
 // A live busy transition closes an already-open portaled menu and protects a pending loader edit.
 await pick('0.19.5');await selector.click();await page.evaluate(()=>{window.folderTest.running=true;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>document.querySelector('.instance-fabric-loader .select-trigger').disabled);
 assert.equal(await page.locator('.select-menu-portal').count(),0);assert.equal(await save.isDisabled(),true);
 await page.evaluate(()=>{window.folderTest.running=false;window.dispatchEvent(new Event('focus'));});await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);
 // Reload discards an unsaved choice. Metadata errors retain the current pin and provide Retry.
 await page.reload();await page.evaluate(()=>window.folderTest.metadataFail=true);await open();await page.getByRole('button',{name:'Retry',exact:true}).waitFor();assert.equal(await selector.isDisabled(),true);assert.match(await selector.innerText(),/0\.18\.4/);
 await saveDone();assert.equal('loaderVersion' in (await calls('update_instance_settings')).at(-1).args,false);await shot('metadata-error');
 await page.evaluate(()=>{window.folderTest.metadataFail=false;window.folderTest.metadataDelay=true;});await page.getByRole('button',{name:'Retry',exact:true}).click();await wait(()=>typeof window.folderTest.releaseMetadata==='function');assert.equal(await selector.isDisabled(),true);
 await page.evaluate(()=>{window.folderTest.metadataDelay=false;window.folderTest.releaseMetadata();});await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);
 await selector.focus();await selector.press('Enter');await page.locator('.select-menu-portal').getByRole('button',{name:'0.21.0-beta.1 (prerelease)',exact:true}).focus();await page.keyboard.press('Enter');assert.match(await selector.innerText(),/prerelease/);
 await saveDone();assert.equal((await calls('update_instance_settings')).at(-1).args.loaderVersion,'0.21.0-beta.1');
 // Vanilla never exposes or fetches Fabric settings. Legacy Fabric can save unrelated fields without silently pinning.
 const count=(await calls('list_instance_fabric_loaders')).length;await open('Vanilla');assert.equal(await selector.count(),0);assert.equal((await calls('list_instance_fabric_loaders')).length,count);await saveDone();assert.equal('loaderVersion' in (await calls('update_instance_settings')).at(-1).args,false);
 await open('Creative');await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);assert.match(await selector.innerText(),/0\.18\.4/);await saveDone();assert.equal('loaderVersion' in (await calls('update_instance_settings')).at(-1).args,false);
 // Late responses from a departed instance cannot change the next instance's picker.
 await open('Vanilla');await page.evaluate(()=>window.folderTest.metadataDelay=true);await open('Meadow');await wait(()=>typeof window.folderTest.releaseMetadata==='function');
 await page.evaluate(()=>{window.folderTest.lateMetadata=window.folderTest.releaseMetadata;window.folderTest.metadataDelay=false;});await open('Creative');await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);await page.evaluate(()=>window.folderTest.lateMetadata());await page.waitForTimeout(100);assert.match(await selector.innerText(),/0\.18\.4/);
 await page.evaluate(()=>localStorage.setItem('loader-test-prefs',JSON.stringify({theme:'light',animations:false})));await page.setViewportSize({width:900,height:680});await page.reload();await open();await page.waitForFunction(()=>!document.querySelector('.instance-fabric-loader .select-trigger').disabled);await selector.click();await shot('light-compact');
 const bounds=await page.locator('.select-menu-portal').boundingBox();assert.ok(bounds.x>=0 && bounds.x+bounds.width<=900 && bounds.y>=0 && bounds.y+bounds.height<=680);
 const beforePin = (await calls('check_mod_maintenance')).length;
 await page.evaluate(()=>{
   const item=window.folderTest.instances.find(i=>i.id==='2');
   item.loaderVersion='0.20.1';
   window.folderTest.emitLoader([item.id,item.version,item.loaderVersion]);
 });
 await page.waitForFunction(expected=>window.folderTest.calls.filter(c=>c.command==='check_mod_maintenance').length===expected,beforePin+1);
 assert.equal((await calls('check_mod_maintenance')).at(-1).args.instanceId,'2');
 assert.deepEqual(errors,[]);console.log('Fabric settings UI passed: real save arguments, upgrade/downgrade persistence, next-launch selection, failed-save retry, busy menu closure, metadata retry, legacy/Vanilla preservation, keyboard prereleases, stale response isolation, compact Light layout.');
} catch(error) {await shot('failure');throw error;} finally {await browser.close();}
