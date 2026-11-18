// Real sidebar UI with native commands intercepted; no user settings or game files change.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(10000);
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#5798ff", animations: true, buttonPressDuration: 750, ...JSON.parse(localStorage.getItem("bloom-settings") || "{}") }));
  const instances = ["SMP", "Creative"].map((name, i) => ({ id: String(i), name, loader: "Fabric", version: "26.3", directory: "test", java: "Automatic", memory: 4096, jvmArguments: "", mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  window.sidebarTest = { calls: [] };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.sidebarTest.calls.push({ command, args, time: performance.now() });
      if (command === "cosmetics_request") return {items:[]};
      if (command === "list_instances") return instances;
      if (command === "list_portal") return { entries: [], warnings: [] };
      if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
      if (command === "get_saved_minecraft_profile") return null;
      if (command === "get_minecraft_process_running" || command === "plugin:window|is_maximized") return false;
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
      if (["list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots", "detect_java_installations", "list_instance_folders", "list_managed_java_runtimes"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "test";
      if (command === "get_client_cache_settings") return { enabled: true, maxBytes: 3e9 };
      return null;
    },
  };
});

const nav=page.getByRole("navigation",{name:"Main navigation"});
const button=name=>nav.getByRole("button",{name,exact:true});
const state=()=>nav.evaluate(el=>{
  const track=el.querySelector(".sidebar-selection");
  const face=el.querySelector(".sidebar-selection-surface") || track;
  const r=face.getBoundingClientRect();
  const m=new DOMMatrixReadOnly(getComputedStyle(track).transform);
  return {centerX:r.x+r.width/2,centerY:r.y+r.height/2,width:r.width,height:r.height,x:m.m41,y:m.m42,active:el.querySelector("button.active")?.getAttribute("aria-label"),scale:getComputedStyle(face).scale};
});
const point=async name=>{const r=await button(name).boundingBox();return {x:r.x+r.width/2,y:r.y+r.height/2};};
const stableCenter=(a,b)=>{assert.ok(Math.abs(a.centerX-b.centerX)<.25,"Press keeps horizontal center");assert.ok(Math.abs(a.centerY-b.centerY)<.25,"Press keeps vertical center");};
try {
  await mkdir("logs/sidebar-press",{recursive:true});
  await page.goto(url);await button("Home").waitFor();await page.waitForTimeout(850);
  const before=await state();const settings=await point("Portal");
  await page.mouse.move(settings.x,settings.y);await page.mouse.down();await page.waitForTimeout(200);
  const held=await state();
  if(process.env.SIDEBAR_BASELINE){
    await page.screenshot({path:"logs/sidebar-press/before.png"});
    console.log(JSON.stringify({before,held}));
  } else {
    stableCenter(before,held);assert.equal(held.y,before.y,"No slide before release");
    assert.equal(await button("Home").getAttribute("aria-current"),"page");
    assert.ok(held.width<before.width*.99,"Held face compresses");
    await page.waitForTimeout(850);const longHold=await state();stableCenter(before,longHold);
    assert.ok(longHold.width<before.width*.99,"Compression stays held beyond the pop duration");
    await page.screenshot({path:"logs/sidebar-press/held.png"});
    await page.mouse.up();await page.waitForTimeout(80);
    assert.equal(await button("Portal").getAttribute("aria-current"),"page");
    await page.waitForFunction(y => {
      const track=document.querySelector(".sidebar-selection");
      return track && new DOMMatrixReadOnly(getComputedStyle(track).transform).m42>y+1;
    },before.y,{timeout:1500});
    await page.waitForTimeout(800);
    const settled=await state();const target=await point("Portal");
    assert.ok(Math.abs(settled.centerY-target.y)<.25);assert.ok(Math.abs(settled.width-before.width)<.25);
    await page.screenshot({path:"logs/sidebar-press/settled.png"});
    // A held click on the active row never shifts its center either.
    await page.mouse.down();await page.waitForTimeout(170);stableCenter(settled,await state());await page.mouse.up();await page.waitForTimeout(800);
    // Release away from the target: no route change, no stuck scale.
    const home=await point("Home");await page.mouse.move(home.x,home.y);await page.mouse.down();await page.waitForTimeout(150);
    await page.mouse.move(550,500);await page.mouse.up();await page.waitForTimeout(800);
    assert.equal(await button("Portal").getAttribute("aria-current"),"page");stableCenter(settled,await state());
    assert.ok(Math.abs((await state()).width-settled.width)<.25);
    // Fast reversals retain the existing slide and land on the last route.
    await button("Home").click();await page.waitForTimeout(90);await button("Instances").click();await page.waitForTimeout(90);await button("Portal").click();await page.waitForTimeout(850);stableCenter(settled,await state());
    // Every row must freeze an interrupted slide, including the lower routes.
    for (const destination of ["Home", "Instances", "Locker", "Social", "Screenshots", "Utilities", "Portal"]) {
      await button("Home").click();await page.waitForTimeout(850);
      await button("Portal").click();await page.waitForTimeout(60);
      const hit=await point(destination);await page.mouse.move(hit.x,hit.y);await page.mouse.down();
      const frozen=await state();await page.waitForTimeout(250);stableCenter(frozen,await state());
      assert.equal(await button("Portal").getAttribute("aria-current"),"page",destination+" does not navigate while held");
      await page.mouse.up();await page.waitForTimeout(850);
      assert.equal(await button(destination).getAttribute("aria-current"),"page");
      assert.ok(Math.abs((await state()).centerY-(await point(destination)).y)<.25,destination+" settles on release");
    }
    // Canceling an interrupted press resumes the already-selected route.
    await button("Home").click();await page.waitForTimeout(850);await button("Portal").click();await page.waitForTimeout(60);
    const social=await point("Social");await page.mouse.move(social.x,social.y);await page.mouse.down();
    const frozen=await state();await page.waitForTimeout(250);stableCenter(frozen,await state());
    await page.mouse.move(550,500);await page.mouse.up();await page.waitForTimeout(850);
    assert.equal(await button("Portal").getAttribute("aria-current"),"page");
    assert.ok(Math.abs((await state()).centerY-(await point("Portal")).y)<.25);
    // Space uses native button activation on release.
    await button("Home").focus();await page.keyboard.down("Space");await page.waitForTimeout(180);stableCenter(settled,await state());
    assert.equal(await button("Portal").getAttribute("aria-current"),"page");await page.keyboard.up("Space");await page.waitForTimeout(850);
    assert.equal(await button("Home").getAttribute("aria-current"),"page");
    for(const prefs of [{theme:"light",sidebarCollapsed:true},{animations:false},{ultraPerformance:true},{buttonPressDuration:0}]){
      await page.evaluate(prefs=>{localStorage.setItem("bloom-settings",JSON.stringify({theme:"oled",animations:true,buttonPressDuration:750,...prefs}));localStorage.setItem("bloom-last-page","home");localStorage.setItem("bloom-sidebar-collapsed",String(!!prefs.sidebarCollapsed));},prefs);
      await page.reload();await button("Home").waitFor();await page.waitForTimeout(200);const rest=await state();const p=await point("Portal");
      await page.mouse.move(p.x,p.y);await page.mouse.down();await page.waitForTimeout(180);const press=await state();stableCenter(rest,press);
      if(!prefs.theme)assert.ok(Math.abs(press.width-rest.width)<.25,"Disabled motion/pop stays still");
      else assert.ok(press.width<rest.width*.99,"Compact Light mode keeps the centered press");
      if(prefs.sidebarCollapsed)assert.ok(rest.width<80,"Compact rail actually applied");
      await page.mouse.up();await page.waitForTimeout(850);assert.equal(await button("Portal").getAttribute("aria-current"),"page");
    }
    await page.evaluate(()=>{localStorage.setItem("bloom-settings",JSON.stringify({theme:"oled",animations:true,buttonPressDuration:750}));localStorage.setItem("bloom-last-page","home");});
    await page.emulateMedia({reducedMotion:"reduce"});await page.reload();await button("Home").waitFor();await page.waitForTimeout(200);
    const rest=await state();await button("Portal").hover();await page.mouse.down();await page.waitForTimeout(180);stableCenter(rest,await state());assert.ok(Math.abs((await state()).width-rest.width)<.25);await page.mouse.up();
    assert.equal(await button("Portal").getAttribute("aria-current"),"page");assert.deepEqual(errors,[]);
    console.log("Sidebar press passed: centered hold, release-only slide, cancellation, rapid reversals, interrupted holds on all seven routes, Space, compact Light, motion preferences and zero duration.");
  }
} catch(error) { console.log("Browser errors:", errors); await page.screenshot({path:"logs/sidebar-press/failure.png"}); throw error; } finally {await browser.close();}
