// Exercise Downloads hit targets and missing-artwork containment in the real React UI.
// Native commands are intercepted; no game process or user instance is changed.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(6500);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", animations: true, buttonPressDuration: 750, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") }));
  const instances = ["SMP", "Creative", "Sky", "Ocean", "Forest", "Mesa"].map((name, i) => ({ id: String(i), name, loader: "Fabric", version: "26.3", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  if(localStorage.getItem("bloom-completed-downloads") === null) localStorage.setItem("bloom-completed-downloads",JSON.stringify([
    {id:"old-game",name:"No artwork",version:"26.3",loader:"Fabric",completedAt:Date.now()},
    {id:"mod",name:"Installed mod",version:"1.0",kind:"mod",targetName:"SMP",completedAt:Date.now(),iconUrl:"data:image/svg+xml,"+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" fill="#5798ff"/></svg>')}
  ]));
  const callbacks = new Map(), listeners = new Map();
  let next = 1;
  const test = window.launchTest = {
    calls: [], running: false, progress: { instanceId: "", state: "idle", progress: 0, message: "" },
    holdPoll: false, releasePoll: null, holdLaunch: false, releaseLaunch: null, failPoll: false,
    emit(event, payload) { for (const [id, listener] of listeners) if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload }); },
    listenerCount(event) { return [...listeners.values()].filter(listener => listener.event === event).length; },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      test.calls.push({ command, args });
      if (command === "plugin:event|listen") { const id = next++; await new Promise(resolve => setTimeout(resolve, 15)); listeners.set(id, args); return id; }
      if (command === "plugin:event|unlisten") { listeners.delete(args.eventId); return null; }
      if (command === "get_minecraft_launch_status") {
        if (test.failPoll) throw "Temporary connection failure";
        const snapshot = structuredClone(test.progress);
        if (test.holdPoll) { test.holdPoll = false; await new Promise(resolve => { test.releasePoll = resolve; }); }
        return snapshot;
      }
      if (command === "get_minecraft_process_running") { if (test.failPoll) throw "Temporary connection failure"; return test.running; }
      if (command === "launch_minecraft") {
        if (test.holdLaunch) { test.holdLaunch = false; await new Promise(resolve => { test.releaseLaunch = resolve; }); }
        test.progress = { instanceId: args.instanceId, state: "installing", progress: 10, message: "Preparing Minecraft" };
        return null;
      }
      if(command === "cancel_minecraft_launch") { test.progress={...test.progress,state:"cancelled"};test.emit("minecraft-launch-progress",test.progress);return null; }
      if (command === "list_instances") {
        if (sessionStorage.getItem("short-library")) return [instances[0], {...instances[1], lastGameLogMs: 1000}];
        return instances;
      }
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
      if (["list_instance_content","list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_instance_folders"].includes(command)) return [];
      if (command === "plugin:app|version") return "test";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});

const downloads=()=>page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Downloads",exact:true}).click();
const section=name=>page.getByRole("navigation",{name:"Download sections"}).getByRole("button",{name,exact:true}).click();
const contained=async()=>{
  const items=await page.locator(".download-task-icon > .instance-icon-fallback").evaluateAll(nodes=>nodes.map(n=>{
    const r=n.getBoundingClientRect(),p=n.parentElement.getBoundingClientRect();
    return {width:r.width,height:r.height,dx:r.x-p.x,dy:r.y-p.y,pointerEvents:getComputedStyle(n).pointerEvents};
  }));
  assert.ok(items.length>0,"Fixture includes an instance without artwork");
  for(const item of items){assert.equal(item.width,48);assert.equal(item.height,48);assert.ok(Math.abs(item.dx)<.25 && Math.abs(item.dy)<.25);assert.equal(item.pointerEvents,"none");}
};
try {
  await mkdir("logs/download-feedback",{recursive:true});
  await page.goto(url);
  const nav = name => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true });
  const shortcuts = page.getByRole("navigation", {name: "Instance shortcuts"});
  await shortcuts.getByRole("button", {name: "SMP", exact:true}).waitFor();
  assert.deepEqual(await shortcuts.getByRole("button").evaluateAll(nodes => nodes.map(node => node.title)), ["SMP", "Creative", "Sky", "Ocean", "Forest"]);
  await nav("Instances").click();
  const instance = page.locator(".desktop-instance-link").filter({ hasText: "SMP" });
  await instance.getByRole("button", { name: "SMP", exact: true }).click();
  await page.locator(".instance-hero-actions").getByRole("button", { name: "Play", exact: true }).click();
  await page.evaluate(() => {
    const t = window.launchTest;
    t.progress = { instanceId: "0", state: "installing", progress: 44, message: "Preparing Minecraft" };
    t.emit("minecraft-launch-progress", t.progress);
  });
  await instance.locator('[role="progressbar"][aria-valuenow="44"]').waitFor();
  await downloads();
  await page.getByText("No active downloads", { exact: true }).waitFor();
  await nav("Instances").click();
  await instance.getByRole("button", { name: "Cancel launch of SMP" }).click();
  await instance.getByRole("progressbar").waitFor({ state: "detached" });
  await downloads();await section("Queued");await page.getByText("The queue is empty.").waitFor();await section("Completed");await page.getByText("No artwork",{exact:true}).waitFor();await contained();
  const clear=page.getByRole("button",{name:"Clear completed",exact:true});
  assert.equal(await clear.evaluate(e=>{const r=e.getBoundingClientRect();return document.elementFromPoint(r.x+r.width/2,r.y+r.height/2)?.closest("button")===e;}),true,"Completed placeholder cannot cover Clear Completed");
  await section("Downloading");
  await page.evaluate(()=>{const t=window.launchTest;t.progress={instanceId:"0",state:"installing",progress:30,message:"Preparing files"};t.emit("minecraft-launch-progress",t.progress);});
  await page.getByRole("button",{name:"Cancel task",exact:true}).waitFor();await contained();
  await page.getByRole("button",{name:"Cancel task",exact:true}).click();
  await page.getByText("No active downloads",{exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.launchTest.calls.filter(c=>c.command==="cancel_minecraft_launch").length),2);
  await page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Instances",exact:true}).click();await downloads();await section("Completed");
  const row=page.locator(".completed-task").first();
  const resting=await row.boundingBox();await row.hover();await page.waitForTimeout(220);
  const hovering=await row.boundingBox();assert.ok(hovering.y<resting.y-.5 && hovering.y>resting.y-2,"Restrained hover lift");
  await page.screenshot({path:"logs/download-feedback/hover.png"});
  await clear.hover();
  await clear.click();
  await page.waitForFunction(()=>localStorage.getItem("bloom-completed-downloads")==="[]");
  // Pause only the decorative exit, proving history is already cleared while rows remain.
  await page.evaluate(()=>{
    window.downloadExitAnimations=document.getAnimations().filter(a=>a.effect?.target instanceof Element && a.effect.target.closest(".download-history-entry[data-leaving]"));
    for(const a of window.downloadExitAnimations){a.pause();a.currentTime=60;}
  });
  assert.equal(await page.locator(".download-history-entry[data-leaving]").count(),2);
  const leaving=page.locator(".download-history-entry[data-leaving]").first();
  assert.ok(await leaving.evaluate((e,height)=>Math.abs(e.getBoundingClientRect().height-height)<.25,resting.height),"The row keeps its space while the fall begins");
  const fall=await page.locator('.download-history-entry[data-leaving] .completed-task').evaluateAll(nodes=>nodes.map(e=>{
    const matrix=new DOMMatrixReadOnly(getComputedStyle(e).transform);return {x:matrix.m41,y:matrix.m42,scale:matrix.m11};
  }));
  assert.ok(Math.abs(fall[0].y)<.1 && fall[1].y>.1,"Bottom row starts falling before the row above it");
  await page.evaluate(()=>window.downloadExitAnimations.forEach(a=>a.currentTime=320));
  assert.ok(await leaving.evaluate((e,height)=>Math.abs(e.getBoundingClientRect().height-height)<.25,resting.height),"Departure precedes the gap collapse");
  assert.ok(await leaving.locator(".completed-task").evaluate(e=>{const m=new DOMMatrixReadOnly(getComputedStyle(e).transform);return m.m42>5 && Math.abs(m.m41)<.1 && m.m11<.99;}),"Row falls straight down and scales inward");
  await page.screenshot({path:"logs/download-feedback/departing.png"});
  await page.evaluate(()=>window.downloadExitAnimations.forEach(a=>a.currentTime=720));
  const collapsing=await leaving.evaluate(e=>e.getBoundingClientRect().height);
  assert.ok(collapsing>10 && collapsing<resting.height-5,"Space eases closed after departure");
  assert.ok(await leaving.evaluate(e=>e.inert && e.getAttribute("aria-hidden")==="true"),"Exiting snapshots stay noninteractive");
  assert.equal(await clear.isDisabled(),true);
  await page.screenshot({path:"logs/download-feedback/clearing.png"});
  // A new completion during the exit is live data, not part of the cleared snapshot.
  await page.evaluate(()=>{const t=window.launchTest;t.progress={instanceId:"1",state:"complete",progress:100,message:"Installed"};t.emit("minecraft-launch-progress",t.progress);});
  await page.locator('.download-history-entry:not([data-leaving])').filter({hasText:"Creative"}).waitFor();
  await page.evaluate(()=>window.downloadExitAnimations.forEach(a=>a.play()));
  await page.waitForFunction(()=>!document.querySelector(".download-history-entry[data-leaving]"));
  assert.equal(await page.locator(".completed-task").count(),1);
  assert.equal(await page.evaluate(()=>JSON.parse(localStorage.getItem("bloom-completed-downloads")).length),1);
  await clear.focus();await clear.press("Enter");await page.getByText("No completed downloads yet",{exact:true}).waitFor();
  await page.waitForFunction(()=>localStorage.getItem("bloom-completed-downloads")==="[]");assert.equal(await clear.isDisabled(),true);
  await page.reload();await downloads();await section("Completed");await page.getByText("No completed downloads yet",{exact:true}).waitFor();
  assert.equal(await page.locator(".download-task-icon > .instance-icon-fallback").count(),0);
  for(const prefs of [{animations:false},{ultraPerformance:true},{theme:"light",reduced:true}]){
    await page.evaluate(prefs=>{localStorage.setItem("bloom-settings",JSON.stringify({theme:"oled",animations:true,...prefs}));localStorage.setItem("bloom-completed-downloads",JSON.stringify([{id:"motion-test",name:"Motion test",version:"26.3",completedAt:Date.now()}]));},prefs);
    await page.emulateMedia({reducedMotion:prefs.reduced?"reduce":"no-preference"});await page.reload();await downloads();await section("Completed");
    await page.getByText("Motion test",{exact:true}).waitFor();const baseline=await page.locator(".completed-task").boundingBox();
    await page.locator(".completed-task").hover();await page.waitForTimeout(200);assert.ok(Math.abs((await page.locator(".completed-task").boundingBox()).y-baseline.y)<.25);
    await clear.click();assert.equal(await page.locator(".download-history-entry").count(),0,"Motion preferences remove history immediately");
  }
  const finishInstall = async completedAt => {
    await page.evaluate(completedAt => {
      const t = window.launchTest;
      t.progress = {instanceId:"0",state:"complete",progress:100,message:"Imported",completedAt};
      t.emit("minecraft-launch-progress", t.progress);
    }, completedAt);
  };
  const when = Date.now();
  await finishInstall(when);
  await page.locator(".completed-task").filter({hasText:"SMP"}).waitFor();
  await page.reload(); await downloads(); await section("Completed");
  await finishInstall(when);
  await finishInstall(when + 1000);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("bloom-completed-downloads")).length === 2);
  assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-completed-downloads")).map(row => row.completedAt)), [when + 1000, when]);
  await page.evaluate(when => {
    const entries = JSON.parse(localStorage.getItem("bloom-completed-downloads"));
    for (const offset of [0, 4, 15, 35, 56, 60000]) {
      const completedAt = when - 120000 + offset;
      entries.push({id:`legacy-instance-${completedAt}`, kind:"game", name:"Legacy install", version:"1.21", completedAt});
    }
    localStorage.setItem("bloom-completed-downloads", JSON.stringify(entries));
  }, when);
  await page.reload(); await downloads(); await section("Completed");
  await page.locator(".completed-task").filter({hasText:"Legacy install"}).first().waitFor();
  assert.equal(await page.locator(".completed-task").filter({hasText:"Legacy install"}).count(), 2);
  const recent = page.getByRole("navigation", {name: "Instance shortcuts"});
  const playState = (id, state) => page.evaluate(({id, state}) => {
    const test = window.launchTest;
    test.progress = {instanceId: id, state, progress: 100, message: state};
    test.emit("minecraft-launch-progress", test.progress);
  }, {id, state});
  for (const id of ["0", "1", "2", "3", "4", "5", "2"]) await playState(id, "running");
  await playState("0", "cancelled");
  const expected = ["Sky", "Mesa", "Forest", "Ocean", "Creative"];
  const names = () => recent.getByRole("button").evaluateAll(nodes => nodes.map(node => node.title));
  assert.deepEqual(await names(), expected);
  await recent.getByRole("button", {name:"Forest"}).click();
  await page.getByRole("heading", {name:"Forest", exact:true}).waitFor();
  assert.deepEqual(await names(), expected);
  await page.reload();
  await recent.getByRole("button", {name:"Sky"}).waitFor();
  assert.deepEqual(await names(), expected);
  await page.evaluate(() => {
    localStorage.removeItem("delight-recently-played-instances");
    sessionStorage.setItem("short-library", "1");
  });
  await page.reload();
  await recent.getByRole("button", {name:"SMP"}).waitFor();
  assert.deepEqual(await names(), ["Creative", "SMP"]);
  assert.deepEqual(errors,[]);
  console.log("Downloads passed: 48px fallback containment, unobstructed controls, active cancellation, navigation, hover, immediate persisted clearing, bottom-first fall/scale before eased collapse, new completion during exit, keyboard clearing, motion preferences and persistence.");
} catch (error) {
  console.error("Page errors",errors, "Visible controls", (await page.getByRole("button").allTextContents()).slice(-28));
  throw error;
} finally {await browser.close();}
