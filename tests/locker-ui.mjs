// Vite browser regression; native account/catalog mutations use fixtures only.
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
  const profile = { id: "fixture-account", name: "Wardrobe Test" };
  localStorage.setItem("bloom-profile", JSON.stringify(profile));
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-settings", JSON.stringify({ theme: "oled", accent: "#f24f54", animations: true, buttonPressDuration: 0 }));
  const canvas = document.createElement("canvas"); canvas.width = canvas.height = 64;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#8f93bf"; ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = "#f2b8d9"; ctx.fillRect(0, 0, 32, 32);
  const texture = canvas.toDataURL();
  const capeCanvas = document.createElement("canvas"); capeCanvas.width = 64; capeCanvas.height = 32;
  capeCanvas.getContext("2d").drawImage(canvas, 0, 0);
  const capeTexture = capeCanvas.toDataURL();
  const cloaks = Array.from({ length: 3 }, (_, i) => ({ id: `cloak-${i}`, name: i === 0 ? "Beta Cape" : `Cloak ${i}`, textureUrl: capeTexture, textureRevision: "1" }));
  const wardrobe = {
    capes: Array.from({ length: 10 }, (_, i) => ({ id: `cape-${i}`, name: `Official Cape ${i}`, texture: capeTexture, active: i === 0 })),
    currentSkin: { id: "current", name: "Current skin", texture, variant: "slim" },
    skins: Array.from({ length: 10 }, (_, i) => { ctx.fillStyle = `rgb(${i+1},0,0)`; ctx.fillRect(0, 0, 1, 1); return {id:`skin-${i}`, name:`Saved skin ${i}`, texture:canvas.toDataURL(), variant:i === 0 ? "slim" : "classic"}; }),
  };
  const control = window.lockerTest = { calls: [], holds: {}, pending: {}, me: { capeId: "cloak-1", badgeVisible: true }, wardrobe, cloaks,
    release(kind) { this.holds[kind] = false; for (const resolve of this.pending[kind] || []) resolve(); this.pending[kind] = []; } };
  const gate = async kind => { if (control.holds[kind]) await new Promise(resolve => (control.pending[kind] ||= []).push(resolve)); };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      control.calls.push({ command, args });
      if (command === "cosmetics_request") {
        if (args.path === "/v1/wings/locker") return { items: [], equipped: null };
        if (args.path === "/v1/capes/shop") return { items: structuredClone(cloaks).map(cape => ({...cape, owned:cape.id !== "cloak-2" || control.claimed})), featuredId:cloaks[0]?.id };
        if (args.path === "/v1/capes/claim") {control.claimed=true;return null;}
        if (args.path === "/v1/capes/redeem") { await gate("redeem"); if (args.body.code === "expired-fixture") throw new Error("This code expired."); cloaks.push({id: "claimed", name: "Claimed fixture", textureUrl: capeTexture, textureRevision: "1"}); return {id: "claimed", name: "Claimed fixture", alreadyClaimed: false}; }
        if (["/v1/capes", "/v1/capes/locker"].includes(args.path)) { await gate("catalog"); return { items: structuredClone(cloaks) }; }
        if (args.path === "/v1/cosmetics/me") { await gate("me"); return { ...control.me }; }
        if (args.path === "/v1/capes/equipped") { await gate("equip"); control.me.capeId = args.body.capeId; return null; }
      }
      if (command === "get_minecraft_wardrobe") { await gate("wardrobe"); return structuredClone(wardrobe); }
      if (command === "set_official_cape") { await gate("equip"); wardrobe.capes.forEach(cape => { cape.active = cape.id === args.capeId; }); return null; }
      if (command === "import_locker_skin" || command === "import_skin_by_username") return control.importResult;
      if (command === "apply_locker_skin") {
        await gate("equip");
        if (control.failWear) throw new Error("Minecraft rejected this skin");
        wardrobe.currentSkin = {...wardrobe.skins.find(s => s.id === args.skinId), id:"current",name:"Current skin",variant:args.variant};
        return null;
      }
      if (command === "get_minecraft_skin") return texture;
      if (command === "list_minecraft_accounts") return { activeId: profile.id, accounts: [profile] };
      if (command === "get_saved_minecraft_profile") return profile;
      if (["list_instances", "reconcile_cosmetics", "list_pack_channel_memberships"].includes(command)) return [];
      if (command === "plugin:event|listen") return next++;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_minecraft_launch_status") return { active: false, progress: 0, state: "idle", message: "" };
      return null;
    },
  };
});
const output = process.env.LOCKER_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
const shot = async name => { if (output) await page.locator(".locker-workspace").screenshot({ path: `${output}/${name}.png` }); };
const nav = async name => { await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click(); };
const tab = name => page.getByRole("navigation",{name:"Locker categories"}).getByRole("button", { name, exact: true }).click();
const hold = kind => page.evaluate(kind => { window.lockerTest.holds[kind] = true; }, kind);
const waiting = kind => page.waitForFunction(kind => window.lockerTest.pending[kind]?.length, kind);
const release = kind => page.evaluate(kind => window.lockerTest.release(kind), kind);
const settle = () => page.waitForTimeout(520);
try {
  await page.goto(url); await nav("Locker");
  await page.getByRole("heading",{name:"Equipped look"}).waitFor();
  await page.getByRole("button",{name:"Delight cloak Cloak 1"}).waitFor();
  await shot("equipped-look");
  await tab("Shop");
  await page.getByRole("button",{name:"Add Cloak 2 to Locker"}).click();
  await page.getByRole("button",{name:"Open Cloak 2 in Locker"}).waitFor();
  assert.equal(await page.evaluate(()=>window.lockerTest.me.capeId),"cloak-1");
  await page.getByRole("textbox",{name:"Search Shop"}).fill("Beta");
  await page.getByRole("button",{name:"Open Beta Cape in Locker"}).first().click();
  await page.getByRole("button", { name: "Wear Beta Cape", exact: true }).waitFor();
  await settle();
  await nav("Home"); await hold("me"); await nav("Locker"); await tab("Cloaks"); await waiting("me");
  await shot("before-account-ready");

  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Cloak 1", "Cached cloaks show the equipped preview immediately");
  await release("me"); await settle();
  await settle();

  const firstCard = page.locator(".locker-cape").first();
  await hold("equip");
  await firstCard.getByRole("button").click();
  await page.locator(".locker-detail canvas").evaluate(el => {
    window.previewContextLosses = 0;
    el.addEventListener("webglcontextlost", () => window.previewContextLosses++);
  });
  await page.getByRole("button",{name:"Wear Cloak 2",exact:true}).click();
  await firstCard.getByRole("button").click();
  assert.equal(await firstCard.getByRole("button").getAttribute("aria-pressed"),"true");
  await waiting("equip");
  assert.equal(await page.evaluate(()=>window.lockerTest.calls.filter(c=>c.args?.path==="/v1/capes/equipped").length),1);
  await release("equip"); await settle();
  assert.equal(await page.evaluate(() => window.previewContextLosses),0);
  await page.locator(".look-heading").click({position:{x:10,y:10}}); await settle();
  await hold("me"); await page.getByRole("button", { name: "Refresh cloaks" }).click(); await waiting("me");

  assert.equal(await firstCard.locator('button[aria-description="Equipped"]').count(), 1, "Refresh retains confirmed equipped state");
  assert.equal(await page.getByRole("button", { name: "Refresh cloaks" }).isDisabled(), true);
  await release("me"); await settle(); await shot("cloaks");
  assert.ok((await firstCard.boundingBox()).width >= 128, "Cards adapt to their actual available column width");

  await tab("Capes"); await hold("equip"); await page.getByRole("button", { name: "Wear Official Cape 1", exact: true }).click();
  await hold("wardrobe"); await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await waiting("wardrobe");
  assert.equal(await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).isDisabled(), true);
  await release("wardrobe"); await settle();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Official Cape 1", "Reload preserves the chosen cape");
  await waiting("equip");
  assert.equal(await page.getByRole("button", { name:"Wear Official Cape 1",exact:true }).getAttribute("aria-pressed"),"true");
  await tab("Equipped look");
  await page.getByRole("button",{name:"Minecraft cape Official Cape 1",exact:true}).waitFor();
  await tab("Capes");
  await release("equip"); await settle();
  await page.getByRole("button",{name:"Unequip",exact:true}).click();
  await page.waitForFunction(()=>window.lockerTest.wardrobe.capes.every(c => !c.active));
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.evaluate(() => { window.lockerTest.wardrobe.capes.length = 2; });
  await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await settle();
  assert.equal(await page.locator(".locker-cape").count(), 2, "Shrinking catalogs cannot strand pagination on an empty page");
  await shot("capes");

  await tab("Skins");
  const tile = name => page.getByRole("button",{name:"Wear "+name,exact:true});
  const first = tile("Saved skin 0");
  await page.evaluate(()=>window.lockerTest.failWear=true);
  await first.click(); await page.waitForTimeout(1200);
  assert.equal(await tile("Current skin").getAttribute("aria-description"),"Equipped");
  await page.evaluate(()=>window.lockerTest.failWear=false);
  const skinWrites = () => page.evaluate(()=>window.lockerTest.calls.filter(c=>c.command==="apply_locker_skin").length);
  const writesBefore = await skinWrites();
  await hold("equip");
  await first.click();
  assert.equal(await first.getAttribute("aria-pressed"), "true");
  const surface = el => getComputedStyle(el).backgroundColor;
  assert.notEqual(await first.evaluate(surface), await tile("Current skin").evaluate(surface));
  await tile("Saved skin 1").click();
  assert.equal(await first.getAttribute("aria-pressed"), "false");
  await first.click();
  await waiting("equip");
  assert.equal(await skinWrites(), writesBefore + 1);
  assert.equal(await first.isEnabled(), true);
  assert.equal(await tile("Current skin").getAttribute("aria-description"),"Equipped");
  await release("equip");
  await page.waitForFunction(() => document.querySelector('button[aria-label="Wear Saved skin 0"]')?.getAttribute("aria-description") === "Equipped");
  assert.equal(await first.getAttribute("aria-description"),"Equipped");
  assert.equal(await tile("Current skin").count(),0);
  assert.equal(await page.locator(".locker-detail-copy,.locker-detail .locker-equip").count(),0);
  const slim = page.getByRole("button",{name:"Slim",exact:true});
  await page.getByRole("button",{name:"Classic",exact:true}).click(); await page.waitForFunction(()=>window.lockerTest.wardrobe.currentSkin.variant==="classic");
  assert.equal(await page.evaluate(()=>window.lockerTest.wardrobe.currentSkin.variant),"classic");
  assert.ok((await page.locator(".skin-workspace canvas").boundingBox()).height <= 430);
  const addSkin = page.getByRole("button", {name:"Add skin",exact:true});
  await page.evaluate(() => window.lockerTest.importResult = null);
  await addSkin.click(); await page.getByRole("button",{name:"Choose PNG…"}).click(); await settle();
  assert.equal(await first.getAttribute("aria-description"),"Equipped");
  await page.evaluate(() => window.lockerTest.importResult = "skin-9");
  await addSkin.click();
  await page.getByRole("textbox",{name:"Minecraft Java username"}).fill("Alex");
  const filePicks = () => page.evaluate(() => window.lockerTest.calls.filter(call => call.command === "import_locker_skin").length);
  const beforeEnter = await filePicks();
  await page.getByRole("textbox",{name:"Minecraft Java username"}).press("Enter");
  assert.equal(await filePicks(), beforeEnter);
  assert.ok(await page.evaluate(() => window.lockerTest.calls.some(call => call.command === "import_skin_by_username" && call.args.username === "Alex")));
  await page.getByRole("button",{name:"Wear Saved skin 9",exact:true}).waitFor();
  assert.equal(await page.evaluate(()=>window.lockerTest.wardrobe.currentSkin.variant),"classic");
  await page.evaluate(() => window.lockerTest.importResult = "skin-0");
  await addSkin.click(); await page.getByRole("button",{name:"Choose PNG…"}).click(); await settle();
  await slim.click(); await page.waitForFunction(()=>window.lockerTest.wardrobe.currentSkin.variant==="slim");
  assert.equal(await page.evaluate(()=>window.lockerTest.wardrobe.currentSkin.variant),"slim");
  await shot("skins");
  for (const theme of ["light", "oled"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const category of ["Cloaks", "Capes", "Skins"]) { await tab(category); await settle(); await shot(`${theme}-${category.toLowerCase()}`); }
  }
  await tab("Cloaks"); await settle();
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });

    await page.getByRole("button", { name: "Wear Beta Cape", exact: true }).focus();
    assert.equal(await page.locator(".locker-cape-identity").first().evaluate(el => getComputedStyle(el).opacity),"1");
  }
  await page.setViewportSize({ width: 900, height: 900 });
  for (const category of ["Cloaks", "Capes", "Skins"]) {
    await tab(category); await settle();
    assert.ok(await page.locator(".locker-workspace").evaluate(el => el.scrollWidth <= el.clientWidth), `${category} fits the compact viewport`);
  }
  await tab("Cloaks"); await settle();
  // Claiming during an equip refresh must settle, reveal its page, and retain confirmed equipment.
  await page.evaluate(() => { for (let i=3;i<12;i++) window.lockerTest.cloaks.push({...window.lockerTest.cloaks[0],id:`extra-${i}`,name:`Extra ${i}`}); });
  await page.getByRole("button", { name: "Refresh cloaks" }).click(); await settle();
  await hold("equip"); await page.locator(".locker-detail .locker-equip").click(); await waiting("equip");
  const redeem = page.getByRole("button",{name:"Redeem code",exact:true});
  const shell = page.getByRole("form",{name:"Redeem code",exact:true});
  const gray = await shell.evaluate(el => getComputedStyle(el).backgroundColor);
  const channels = gray.match(/\d+/g).map(Number);
  assert.equal(channels[0], channels[1]); assert.equal(channels[1], channels[2]);
  const before = await shell.boundingBox();
  await redeem.click();
  await settle();
  const after = await shell.boundingBox();
  assert.ok(after.width > before.width && Math.abs(after.y-before.y)<1 && Math.abs(after.x+after.width-before.x-before.width)<2);
  await page.keyboard.press("Escape"); await redeem.click();
  await page.getByRole("textbox",{name:"Enter cape code"}).fill("expired-fixture");
  await page.keyboard.press("Enter");
  await page.getByText("Code expired",{exact:true}).waitFor();
  await redeem.click();
  await page.getByRole("textbox", {name:"Enter cape code"}).fill("fixture");
  await page.getByRole("button", {name:"Claim cape",exact:true}).click();
  await page.getByText("Redeemed",{exact:true}).waitFor();
  await page.getByRole("button", {name:"Wear Claimed fixture",exact:true}).waitFor();
  assert.equal(await page.locator(".locker-pagination span").textContent(),"2 / 2");
  await release("equip");
  await settle();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(),"Claimed fixture");
  await page.evaluate(()=>{window.lockerTest.cloaks.length=3;});
  await page.getByRole("button", { name: "Refresh cloaks" }).click(); await settle();
  await page.evaluate(() => { window.lockerTest.cloaks[0].name = "Published cape update"; window.dispatchEvent(new Event("focus")); });
  await page.getByRole("button", { name: "Wear Published cape update", exact: true }).waitFor();
  await settle();
  await page.clock.install();
  await page.evaluate(() => { window.lockerTest.cloaks[0].name = "Polling cape update"; });
  await page.clock.runFor(15100);
  await page.getByRole("button", { name: "Wear Polling cape update", exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log("Passed Locker interactions: immediate skin, cape and cloak selection, coalesced saves, unequip, skin model changes, imports, redemption and compact layouts. Native calls simulated.");
} catch (error) { await shot("failure"); throw error; }
finally { await browser.close(); }
