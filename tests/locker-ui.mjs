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
    skins: Array.from({ length: 10 }, (_, i) => ({ id: `skin-${i}`, name: `Saved skin ${i}`, texture, variant: i === 0 ? "slim" : "classic" })),
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
        if (args.path === "/v1/capes") { await gate("catalog"); return { items: structuredClone(cloaks) }; }
        if (args.path === "/v1/cosmetics/me") { await gate("me"); return { ...control.me }; }
        if (args.path === "/v1/capes/equipped") { await gate("equip"); control.me.capeId = args.body.capeId; return null; }
      }
      if (command === "get_minecraft_wardrobe") { await gate("wardrobe"); return structuredClone(wardrobe); }
      if (command === "set_official_cape") { await gate("equip"); wardrobe.capes.forEach(cape => { cape.active = cape.id === args.capeId; }); return null; }
      if (command === "import_locker_skin") return "skin-0";
      if (command === "apply_locker_skin") { await gate("equip"); return null; }
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
const nav = name => page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name, exact: true }).click();
const tab = name => page.getByRole("tab", { name, exact: true }).click();
const hold = kind => page.evaluate(kind => { window.lockerTest.holds[kind] = true; }, kind);
const waiting = kind => page.waitForFunction(kind => window.lockerTest.pending[kind]?.length, kind);
const release = kind => page.evaluate(kind => window.lockerTest.release(kind), kind);
const settle = () => page.waitForTimeout(520);
const hiddenActions = async () => assert.deepEqual(await page.locator(".locker-card-equip").evaluateAll(buttons => buttons.map(button => getComputedStyle(button).opacity)), ["0", "0", "0"], "Hidden Equip buttons must not appear over names while disabled");
try {
  await page.goto(url); await nav("Locker");
  await page.getByRole("button", { name: "Preview Beta Cape", exact: true }).waitFor();
  await settle();
  await nav("Home"); await hold("me"); await nav("Locker"); await waiting("me");
  await shot("before-account-ready");
  await hiddenActions();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Beta Cape", "Cached cloaks have a selected preview immediately");
  await release("me"); await page.waitForFunction(() => !document.querySelector(".locker-detail .locker-equip").disabled);
  await settle(); await hiddenActions();

  // Saving must only reveal the hovered card's action, never its neighbors.
  const firstCard = page.locator(".locker-cape").first();
  await firstCard.hover(); await settle();
  assert.equal(await firstCard.locator(".locker-card-equip").evaluate(el => getComputedStyle(el).opacity), "1");
  assert.equal(await firstCard.locator(".locker-cape-identity").evaluate(el => getComputedStyle(el).opacity), "0");
  await hold("equip"); await firstCard.locator(".locker-card-equip").click(); await waiting("equip");
  assert.equal(await page.locator(".locker-cape").nth(1).locator(".locker-card-equip").evaluate(el => getComputedStyle(el).opacity), "0");
  assert.equal(await firstCard.getByLabel("Equipped", { exact: true }).count(), 0, "Equip state waits for native success");
  await release("equip"); await firstCard.getByLabel("Equipped", { exact: true }).waitFor({ state: "attached" });
  await page.locator(".locker-platform").click(); await settle();
  await hold("me"); await page.getByRole("button", { name: "Refresh cloaks" }).click(); await waiting("me");
  await hiddenActions();
  assert.equal(await firstCard.getByLabel("Equipped", { exact: true }).count(), 1, "Refresh retains confirmed equipped state");
  assert.equal(await page.getByRole("button", { name: "Refresh cloaks" }).isDisabled(), true);
  await release("me"); await settle(); await shot("cloaks");
  assert.ok((await firstCard.boundingBox()).width >= 128, "Cards adapt to their actual available column width");

  await tab("Capes"); await page.getByRole("button", { name: "Preview Official Cape 1", exact: true }).click();
  await hold("wardrobe"); await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await waiting("wardrobe");
  assert.equal(await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).isDisabled(), true);
  await release("wardrobe"); await settle();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Official Cape 1", "Reload preserves the chosen cape");
  await hold("equip"); await page.locator(".locker-detail .locker-equip").click(); await waiting("equip");
  assert.equal(await page.getByRole("button", { name: "Preview Official Cape 1", exact: true }).locator("..").getByLabel("Equipped", { exact: true }).count(), 0);
  await release("equip"); await page.waitForFunction(() => document.querySelector(".locker-detail .locker-equip").textContent === "Unequip");
  await page.getByRole("button", { name: "Next page", exact: true }).click();
  await page.evaluate(() => { window.lockerTest.wardrobe.capes.length = 2; });
  await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await settle();
  assert.equal(await page.locator(".locker-cape").count(), 2, "Shrinking catalogs cannot strand pagination on an empty page");
  await shot("capes");

  await tab("Skins"); await page.getByRole("button", { name: "Preview Saved skin 0", exact: true }).click();
  const slim = page.getByRole("button", { name: "Slim", exact: true });
  const classic = page.getByRole("button", { name: "Classic", exact: true });
  assert.equal(await slim.getAttribute("aria-pressed"), "true");
  await classic.click();
  await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await settle();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Saved skin 0");
  assert.equal(await classic.getAttribute("aria-pressed"), "true", "Reload preserves an unsaved arm-model choice");
  await page.getByRole("button", { name: "Upload skin", exact: true }).click(); await settle();
  assert.equal(await slim.getAttribute("aria-pressed"), "true", "Imported skin uses its saved model");
  await hold("equip"); await page.getByRole("button", { name: "Use skin", exact: true }).click(); await waiting("equip");
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Saved skin 0");
  await release("equip"); await page.waitForFunction(() => document.querySelector(".locker-detail-copy h2").textContent === "Current skin");
  assert.equal(await page.getByRole("button", { name: "Current skin", exact: true }).isDisabled(), true);
  assert.ok(await page.evaluate(() => window.lockerTest.calls.some(call => call.command === "apply_locker_skin" && call.args.skinId === "skin-0" && call.args.variant === "slim")));
  await shot("skins");
  assert.ok((await page.locator(".locker-detail").boundingBox()).height < 650, "The preview does not stretch to the height of a long skin grid");
  await page.evaluate(() => { window.lockerTest.wardrobe.currentSkin = null; });
  await page.getByRole("button", { name: "Reload wardrobe from Minecraft" }).click(); await settle();
  assert.equal(await page.locator(".locker-detail-copy h2").textContent(), "Saved skin 0", "A local skin remains usable when no current skin is returned");

  for (const theme of ["light", "oled"]) {
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; }, theme);
    for (const category of ["Cloaks", "Capes", "Skins"]) { await tab(category); await settle(); await shot(`${theme}-${category.toLowerCase()}`); }
  }
  await tab("Cloaks"); await settle();
  for (const mode of ["off", "ultra", "reduced"]) {
    await page.evaluate(mode => { document.documentElement.dataset.animations = mode === "off" ? "off" : "on"; document.documentElement.dataset.performance = mode === "ultra" ? "ultra" : "normal"; }, mode);
    await page.emulateMedia({ reducedMotion: mode === "reduced" ? "reduce" : "no-preference" });
    await hiddenActions();
    assert.equal(await page.locator(".locker-card-equip").first().evaluate(el => getComputedStyle(el).transitionDuration), "0s");
    await page.getByRole("button", { name: "Preview Beta Cape", exact: true }).focus();
    assert.equal(await page.locator(".locker-card-equip").first().evaluate(el => getComputedStyle(el).opacity), "1", "Keyboard focus reveals the real action without animation");
    await page.getByRole("tab", { name: "Cloaks", exact: true }).focus();
  }
  await page.setViewportSize({ width: 900, height: 900 });
  for (const category of ["Cloaks", "Capes", "Skins"]) {
    await tab(category); await settle();
    assert.ok(await page.locator(".locker-workspace").evaluate(el => el.scrollWidth <= el.clientWidth), `${category} fits the compact viewport`);
  }
  assert.deepEqual(errors, []);
  console.log("Passed: cached cloak load and saving without action flashes; hover/keyboard reveals; truthful equip/apply; cape/skin refresh selection, arm model and pagination; themes, compact layouts and reduced motion. Native calls simulated.");
} catch (error) { await shot("failure"); throw error; }
finally { await browser.close(); }
