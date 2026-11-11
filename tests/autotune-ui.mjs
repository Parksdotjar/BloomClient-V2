// Real React workflow with a native command fixture; Minecraft is tested separately.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", error => errors.push(error.message));
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1422";
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#ed50b0", animations: false, buttonPressDuration: 0 }));
  localStorage.setItem("bloom-autotune-accepted", "true");
  localStorage.setItem("bloom-autotune-hardware", "{}");
  const sample = {version:2,minecraftVersion:"26.3",runId:"test-run",interrupted:false,seed:1,durationSeconds:60,averageFps:100,onePercentLow:60,averageFrameTimeMs:10,p95FrameTimeMs:20,averageMemoryBytes:1e9,peakMemoryBytes:1.5e9,frames:6000,width:1280,height:720,completedAt:123};
  const state = window.autoTuneTest = {calls:[],launch:{state:"idle"},status:null,result:null,failLaunch:true,failApply:true,applied:null,sample};
  Object.defineProperty(navigator, "clipboard", {value:{async writeText(text){state.copied=text;}}});
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {metadata:{currentWindow:{label:"main"},currentWebview:{label:"main"}},transformCallback(){return next++;},unregisterCallback(){},convertFileSrc(p){return p;},async invoke(command,args){
    state.calls.push({command,args});
    if(command === "install_autotune_benchmark"){state.result=null;state.status=null;state.launch={instanceId:"bloom-autotune-benchmark",state:"complete",progress:100,message:"Benchmark installed"};return "bloom-autotune-benchmark";}
    if(command === "launch_minecraft"){
      for(const key of ["instanceId","launchMethod","downloadWorkers","debugLogging"]) if(args[key] === undefined) throw `missing required key ${key}`;
      if(state.failLaunch) throw "Sign in with Microsoft before launching Minecraft.";
      state.launch={instanceId:"bloom-autotune-benchmark",state:"launching",progress:0,message:"Starting Minecraft"};state.status={state:"warmup",runId:"test-run",progress:12,message:"Warming up chunks and the renderer"};return;
    }
    if(command === "get_minecraft_launch_status") return state.launch;
    if(command === "cancel_autotune_benchmark"){state.status=null;state.launch={instanceId:"bloom-autotune-benchmark",state:"cancelled",message:"Benchmark cancelled",progress:0};return;}
    if(command === "get_autotune_benchmark_status") return state.status;
    if(command === "get_autotune_benchmark_result") return state.result;
    if(command === "detect_hardware_report") return {ramBytes:16*1073741824,refreshRate:144,recommendedRenderDistance:16,recommendedSimulationDistance:12};
    if(command === "get_applied_autotune_profile") return state.applied;
    if(command === "apply_autotune_profile"){if(state.failApply) throw "Close Minecraft before applying AutoTune.";state.applied=args.profile;return 1;}
    if(command === "list_instances") return [{id:"java",name:"Test world",engine:"java",version:"26.3",loader:"Fabric",memory:4096,directory:"C:/test"},{id:"native",name:"Native",engine:"sakura",version:"26.1",loader:"Sakura",directory:"C:/native"}];
    if(command === "list_minecraft_accounts") return {activeId:null,accounts:[]};
    if(command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
    if(["list_pack_channel_memberships","reconcile_cosmetics","list_cached_screenshots","detect_java_installations","list_instance_folders"].includes(command)) return [];
    if(command === "plugin:event|listen") return next++;
    if(command === "plugin:app|version") return "1.1.8";
    if(command === "get_client_cache_settings") return {enabled:true,maxBytes:3e9};
    if(command === "get_global_file_sync_state") return {settings:{optionsSource:null,serversSource:null,voiceChatSource:null,voiceChatTargets:[],shareResourcePacks:false,shareShaderPacks:false},statuses:[],backupRoot:""};
    return null;
  }};
});
const nav = async () => { await page.getByRole("navigation",{name:"Main navigation"}).getByRole("button",{name:"Utilities",exact:true}).click();await page.locator(".utility-card").filter({has:page.getByRole("heading",{name:"AutoTune",exact:true})}).getByRole("button",{name:"Configure"}).click(); };
const shot = async name => { if(process.env.AUTOTUNE_SCREENSHOTS){await mkdir(process.env.AUTOTUNE_SCREENSHOTS,{recursive:true});await page.screenshot({path:`${process.env.AUTOTUNE_SCREENSHOTS}/${name}.png`});} };
try {
  await page.goto(url,{waitUntil:"domcontentloaded"});await nav();
  await page.getByText("Benchmark Minecraft 26.3",{exact:true}).waitFor();await shot("install-oled");
  await page.getByRole("button",{name:"Install",exact:true}).click();await page.getByRole("button",{name:"Run test",exact:true}).click();
  await page.getByText("Benchmark stopped",{exact:true}).waitFor();assert.match(await page.getByRole("alert").innerText(),/Sign in/);await shot("launch-error");
  await page.evaluate(()=>window.autoTuneTest.failLaunch=false);await page.getByRole("button",{name:"Try again",exact:true}).click();await page.getByRole("button",{name:"Run test",exact:true}).click();
  await page.getByText("Warming up chunks and the renderer",{exact:true}).first().waitFor();
  assert.equal(await page.locator('.autotune-flow-progress [aria-current="step"]').evaluate(el=>Array.from(el.parentElement.children).indexOf(el)),2);
  await page.getByRole("button",{name:"Stop test",exact:true}).click();await page.getByText("Benchmark stopped",{exact:true}).waitFor();
  assert.match(await page.getByRole("alert").innerText(),/cancelled/);
  await page.getByRole("button",{name:"Try again",exact:true}).click();await page.getByRole("button",{name:"Run test",exact:true}).click();
  await page.getByText("Warming up chunks and the renderer",{exact:true}).first().waitFor();
  // Unexpected process exit must leave the progress state.
  await page.evaluate(()=>window.autoTuneTest.launch={instanceId:"bloom-autotune-benchmark",state:"idle",progress:0,message:"Minecraft closed"});
  await page.getByText("Benchmark stopped",{exact:true}).waitFor();assert.match(await page.getByRole("alert").innerText(),/closed before completing/);
  await page.getByRole("button",{name:"Try again",exact:true}).click();await page.getByRole("button",{name:"Run test",exact:true}).click();
  await page.getByText("Warming up chunks and the renderer",{exact:true}).first().waitFor();
  await page.evaluate(()=>{window.autoTuneTest.result=window.autoTuneTest.sample;window.autoTuneTest.status={state:"complete",runId:"test-run",progress:100,message:"Minecraft benchmark complete"};});
  await page.getByText("100.0 FPS",{exact:true}).waitFor();await shot("measured-result");
  await page.getByRole("button",{name:"Continue",exact:true}).click();await page.getByRole("button",{name:"Build profile",exact:true}).click();
  await page.getByRole("button",{name:"Apply profile",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.autoTuneTest.calls.filter(c=>c.command==="apply_autotune_profile").length),0);
  await page.getByRole("button",{name:"Apply profile",exact:true}).click();await page.getByText("Apply to 1 Java instance?",{exact:true}).waitFor();
  await page.getByRole("button",{name:"Apply",exact:true}).click();await page.getByRole("alert").filter({hasText:"Close Minecraft"}).waitFor();
  assert.equal(await page.getByRole("heading",{name:"AutoTune complete"}).count(),0);
  await page.evaluate(()=>window.autoTuneTest.failApply=false);await page.getByRole("button",{name:"Apply",exact:true}).click();
  await page.getByRole("heading",{name:"AutoTune complete"}).waitFor();await shot("complete-oled");
  await page.getByRole("button",{name:/Sodium/}).click();assert.ok(await page.evaluate(()=>window.autoTuneTest.calls.some(c=>c.command==="plugin:opener|open_url" && c.args.url==="https://modrinth.com/mod/sodium")));
  await page.getByText("Measurements & tuning reasons",{exact:true}).click();await page.getByText("Java settings",{exact:true}).waitFor();
  await page.getByText("Run log",{exact:true}).click();await page.getByRole("log").waitFor();assert.match(await page.getByRole("log").innerText(),/Applied settings to 1 Java/);
  await page.getByRole("button",{name:"Copy report",exact:true}).click();await page.getByRole("button",{name:"Report copied",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>JSON.parse(window.autoTuneTest.copied).benchmark.minecraftVersion),"26.3");
  await page.evaluate(()=>document.documentElement.dataset.theme="light");await page.setViewportSize({width:1100,height:720});await shot("complete-light-compact");
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  // Navigating away and back restores the native confirmed state.
  await nav();await page.getByRole("heading",{name:"AutoTune complete"}).waitFor();await shot("complete-light-collapsed");
  assert.deepEqual(errors,[]);console.log("AutoTune UI passed: launch payload, retry, process exit, measured results, confirmation, apply failure, success, mod links, logs, restoration and compact Light layout.");
} finally { await browser.close(); }
