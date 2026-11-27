// Run against a build with VITE_ONBOARDING_PREVIEW=1. Each walkthrough gets fresh storage.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
try {
  for (const preview of [true, false]) {
    const page = await browser.newPage();
    await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.addInitScript(preview => {
      let active = preview ? { id: "fixture", name: "Preview" } : null;
      if (preview) localStorage.setItem("bloom-onboarding-complete-v1", "complete");
      window.calls = [];
      let callback = 0;
      window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
      window.__TAURI_INTERNALS__ = {
        metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
        transformCallback: () => ++callback, unregisterCallback() {}, convertFileSrc: src => src,
        async invoke(cmd, args) {
          window.calls.push({cmd, args});
          switch (cmd) {
            case "get_saved_minecraft_profile": return active;
            case "list_minecraft_accounts": return { accounts: active ? [active] : [], activeId: active?.id };
            case "onboarding_storage": return {defaultPath:"P:/Default",path:null,existing:preview};
            case "init_onboarding_storage": return;
            case "choose_game_directory": return "P:/Fixture instances";
            case "request_microsoft_device_code": return { user_code:"TEST1234", verification_uri:"https://microsoft.com/devicelogin", device_code:"fixture", interval:1, expires_in:600 };
            case "complete_microsoft_login": return new Promise(resolve => {
              window.finishLogin = () => { active = { id: "fixture", name: "Fixture" }; resolve(active); };
            });
            case "copy_text_to_clipboard": return true;
            case "list_instances": return [];
            default: throw new Error("Unavailable in onboarding fixture");
          }
        }
      };
    }, preview);
    const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
    const open = name => button(name, page.getByRole("navigation", {name:"Main navigation"})).click();
    await page.goto(url);
    if (preview) {

      await open("Settings");
      await button("Advanced").click();
      const saved=()=>page.evaluate(()=>[localStorage.getItem("bloom-settings"),localStorage.getItem("bloom-profile"),localStorage.getItem("bloom-onboarding-complete-v1")]);
      const before=await saved();
      await button("Preview onboarding").click();
      await button("Light").click();
      await button("Exit preview").click();
      assert.deepEqual(await saved(), before);
      await button("Preview onboarding").click();
      await button("Light").click();
      await button("Next").click();
      await button("Choose custom accent color").click();
      await button("Apply color").click();
      await button("Green").click();
      await button("Back").click();
      assert.equal(await button("Light").getAttribute("aria-pressed"),"true");
      await button("Next").click();
      await button("Next").click();
      await button(/Choose a location/).click();
      await page.getByText("P:/Fixture instances/Delight Client").waitFor();
      await button("Next").click();
      await button("Connect Microsoft").click();
      const card = button(/Copy Microsoft code/);
      assert.equal(await card.evaluate(el => getComputedStyle(el).borderTopLeftRadius === getComputedStyle(el.parentElement).borderTopLeftRadius), true);
      await card.click();
      await page.getByRole("button",{name:/Open Microsoft sign-in/}).click();
      await button("Continue to launcher").click();
      await button("Preview onboarding").waitFor();
      assert.deepEqual(await saved(),before);
      assert.deepEqual(await page.evaluate(()=>window.calls.filter(x=>["init_onboarding_storage","request_microsoft_device_code","complete_microsoft_login"].includes(x.cmd))),[]);
      console.log("Preview walkthrough passed, including temporary custom folder and simulated device-code flow.");
    } else {

      await button("Light").click();
      await button("Next").click();
      await button("Purple").click();
      await button("Next").click();
      await button(/Choose a location/).click();
      await button("Next").click();
      await button("Connect Microsoft").click();
      const card = button(/Copy Microsoft code/);
      assert.equal(await card.evaluate(el => getComputedStyle(el).borderTopLeftRadius === getComputedStyle(el.parentElement).borderTopLeftRadius), true);
      await card.click();
      assert.notEqual(await page.evaluate(()=>localStorage.getItem("bloom-onboarding-complete-v1")),"complete");
      await page.evaluate(()=>window.finishLogin());
      await button("Continue to launcher").click();
      await open("Settings");
      const [settings,flag]=await page.evaluate(()=>[JSON.parse(localStorage.getItem("bloom-settings")),localStorage.getItem("bloom-onboarding-complete-v1")]);
      assert.deepEqual([settings.theme,settings.accent,settings.gameDirectory,flag],["light","#a78bfa",".minecraft/instances/","complete"]);
      assert.deepEqual(await page.evaluate(()=>window.calls.filter(x=>x.cmd==="init_onboarding_storage").map(x=>x.args.parent)),["P:/Fixture instances"]);
      console.log("First launch applied the selected settings after the simulated Microsoft callback.");

    }
    await page.close();
  }
} finally { await browser.close(); }
