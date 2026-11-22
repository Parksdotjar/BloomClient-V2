import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(15_000);
page.on("pageerror", error => console.error("Browser error:", error.message));
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
const saved = new Map();
const calls = [];
const chatRequests = [];
const irisQuestion = "What’s the newest stable Iris build for my Minecraft version as of today? Where did you verify it?";
const versionQuestion = "Which Minecraft version are you using?";
const loaderQuestion = "For Iris on Minecraft 26.3, which mod loader are you using?";
let account = "minecraft-delight-a";
let usageError = null;
let queue = [];
let socialSignedIn = true;
const friendList = [
  { id: "friend-a", username: "alexa", displayName: "Alexa", avatarUrl: null, minecraftUuid: null },
  { id: "friend-b", username: "mo", displayName: "Morgan", avatarUrl: null, minecraftUuid: null },
];
const socialSession = { signedIn: true, needsUsername: false, user: { id: "owner", username: "tester" } };
let releaseAnswer;
const pendingAnswer = new Promise(resolve => { releaseAnswer = resolve; });
const instance = { id: "example", name: "Survival", version: "26.3", loader: "Fabric", directory: "Test", memory: 4096, jvmArguments: "" };
const usage = { dailyLimit: 10, dailyRemaining: 8, monthlyRemaining: 98, dailyReset: Date.UTC(2026, 10, 19),
  monthlyReset: Date.UTC(2026, 11, 1), serverTime: Date.UTC(2026, 10, 18, 21), blocking: null, mode: "ai" };
await page.route("**/*", route => route.request().url().startsWith(url) || route.request().url().startsWith("data:") ? route.continue() : route.abort());
await page.exposeFunction("askTestBridge", async (command, args) => {
  calls.push(command);
  if (command === "ask_delight_scope") return account;
  if (command === "ask_delight_history") {
    assert.equal(args.account, account);
    const current = saved.get(account) ?? { version: 1, save: true, selected: null, threads: [] };
    const edit = args.edit;
    if (!edit) return current;
    if (edit.type === "select") current.selected = edit.id;
    if (edit.type === "saveThread") {
      current.threads = [edit.thread, ...current.threads.filter(thread => thread.id !== edit.thread.id)];
      if (edit.select) current.selected = edit.thread.id;
    }
    if (edit.type === "clear") { current.threads = []; current.selected = null; }
    if (edit.type === "delete") current.threads = current.threads.filter(thread => thread.id !== edit.id);
    if (edit.type === "setSaving") current.save = edit.save;
    saved.set(account, current);
    return null;
  }
  if (command === "ask_delight_remote") {
    assert.equal(args.account, account);
    if (!args.body) return usageError ? { error: usageError } : { usage };
    chatRequests.push(args.body);
    if (args.body.context.pack) {
      const revised = args.body.question === "Add Lithium";
      if (revised) assert.deepEqual(args.body.context.pack.mods, ["sodium"]);
      else assert.equal(args.body.context.pack, true);
      const mods = [{id:"AANobbMI",slug:"sodium",title:"Sodium"}];
      if (revised) mods.push({id:"gvQqBUqZ",slug:"lithium",title:"Lithium"});
      return {usage,result:{answer:"Review your pack.",status:"answered",action:null,helpIds:[],pack:{name:"Fast",minecraft:"1.21.1",loader:"fabric",mods}}};
    }
    assert.deepEqual(Object.keys(args.body.context).filter(k => k !== "inventory").sort(), ["build", "loader", "page", "platform"]);
    assert.ok(args.body.recent.length <= 2);
    if (args.body.question.startsWith("Which mods would you replace?")) {
      assert.equal(args.body.context.inventory.minecraft, "26.3");
      assert.equal(args.body.context.inventory.mods.length, 61);
      assert.ok(args.body.context.inventory.mods.includes("Fixture Mod 60 1"));
      assert.deepEqual(args.body.context.inventory.disabled, ["Disabled Secret 1"]);
      assert.equal(args.body.context.loader, "fabric");
      assert.ok(Buffer.byteLength(args.body.question) <= 1600);
      return {usage,result:{status:"answered",answer:"Consider replacing a mod from Survival.",helpIds:[],action:null}};
    }
    if (args.body.question.startsWith("What’s the purpose of Lithium?")) {
      assert.deepEqual(args.body.context.inventory.mods, ["Sodium","Lithium"]);
      return {usage,result:{status:"answered",answer:"Lithium is in this performance draft.",helpIds:[],action:null}};
    }
    if (args.body.question === "Tell me about this instance") {
      return {usage,result:{status:"answered",answer:"No pack was attached.",helpIds:[],action:null}};
    }
    calls.push("paid-attempt");
    usage.dailyRemaining--;
    await pendingAnswer;
    if (args.body.question === "Where do I switch accounts?") return {usage,result:{status:"answered",answer:"Choose the saved Minecraft account in My Profile and confirm.",helpIds:[],action:null}};
    if (args.body.question === "How do I change this instance's RAM?") return {usage,result:{status:"answered",answer:"Adjust Memory in Instance settings and save changes.",helpIds:[],action:null,destination:"instance-memory"}};
    if (args.body.question === irisQuestion) {
      assert.deepEqual(args.body.recent, []);
      return { usage, result: { answer: versionQuestion, choices:["1.21.1","1.20.1"], status: "clarify", helpIds: [], action: null } };
    }
    if (args.body.question === "minecraft 26.3") {
      assert.deepEqual(args.body.recent, [[irisQuestion, versionQuestion]]);
      return { usage, result: { answer: loaderQuestion, choices:["Fabric","NeoForge"], status: "clarify", helpIds: [], action: null } };
    }
    if (args.body.question === "Fabric") {
      assert.deepEqual(args.body.recent, [[irisQuestion, versionQuestion], ["minecraft 26.3", loaderQuestion]]);
      return { usage, result: { answer: "**Latest stable Iris** for Fabric 26.3.\n\n- Verified file\n\nhttps://modrinth.com/mod/iris/version/vTN4NRGW", status: "answered", helpIds: [], action: null } };
    }
    return { usage, result: { answer: "For an existing instance, edit Memory from its instance settings.", status: "answered", helpIds: ["memory"], action: "memory" } };
  }
  if (command === "plugin:app|version") return "1.1.8";
  if (command === "social_share_context") {
    if (!socialSignedIn) throw "Sign in to your Delight account before sharing an instance.";
    return { session: socialSession, friends: friendList };
  }
  if (command === "social_session_state") return socialSignedIn ? socialSession : { signedIn: false, user: null, needsUsername: false };
  if (command === "social_snapshot") {
    return { session: socialSession, friends: friendList, requests: { incoming: [], outgoing: [] },
      conversations: [], groups: [], invites: [], messages: [], syncWarning: null };
  }
  if (command === "social_wait_for_updates") return new Promise(resolve => setTimeout(() => resolve({ cursor: "1", changed: false, scopes: [] }), 1000));
  if (command === "plugin:window|start_dragging") return null;
  if (command === "create_alula_instance") {
    assert.equal(args.config.version, "1.21.1");
    assert.equal(args.config.loader, "Fabric");
    return {...args.config,id:"alula-" + args.packDraft};
  }
  if (command === "install_modrinth_content") {
    await new Promise(resolve => setTimeout(resolve, 120));
    assert.ok(args.instanceId.startsWith("alula-"));
    assert.equal(args.category,"mods");
    return {sessionId:"fixture",revision:queue.length,tasks:queue};
  }
  if (command === "list_instances") return [instance];
  if (command === "list_instance_content" && args.instanceId === instance.id && args.category === "mods") return [
    {name:"Sodium",version:"0.6.13",fileName:"private-path.jar",enabled:true},
    {name:"Disabled Secret",version:"1",fileName:"disabled.jar.disabled",enabled:false},
    ...Array.from({length:60}, (_, index) => ({name:"Fixture Mod " + (index + 1),version:"1",fileName:"mod-" + index + ".jar",enabled:true})),
  ];
  if (command === "list_minecraft_accounts") return { activeId: null, accounts: [] };
  if (command === "get_minecraft_launch_status") return { active: false, state: "idle", progress: 0, message: "" };
  if (command === "get_content_downloads") return { sessionId: "fixture", revision: queue.length, tasks: queue };
  if (command === "get_minecraft_releases") return [{ id: "26.3", type: "release" }];
  if (command === "cosmetics_request") return { items: [] };
  if (["list_instance_content", "list_pack_channel_memberships", "reconcile_cosmetics", "list_cached_screenshots",
    "detect_java_installations", "list_instance_folders", "list_managed_java_runtimes"].includes(command)) return [];
  return null;
});
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  localStorage.setItem("bloom-last-page", "home");
  localStorage.setItem("bloom-settings", JSON.stringify({
    theme: localStorage.getItem("ask-delight-fixture-theme") || "oled", animations: true, startupBehavior: "Remember last page",
    recommendations: localStorage.getItem("ask-delight-fixture-recommendations") !== "off",
    rightSidebar: JSON.parse(localStorage.getItem("bloom-settings") ?? "{}").rightSidebar,
  }));
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    invoke(command, args) { return command === "plugin:event|listen" ? Promise.resolve(next++) : window.askTestBridge(command, args); },
  };
});
await mkdir("logs/ask-delight-rail", { recursive: true });
const capture = name => page.screenshot({ path: `logs/ask-delight-rail/${name}.png`, animations: "disabled" });
const rail = page.getByRole("complementary", { name: "Alula" });
const composer = rail.getByRole("textbox", { name: "Your question" });
const captureComposer = name => rail.locator(".ask-footer").screenshot({ path: `logs/ask-delight-rail/${name}.png`, animations: "disabled" });
const packBar = rail.locator(".ask-pack-bar");
const packSelector = packBar.getByRole("button", { name: /^Select modpack/ });
const checkPackBarPlacement = () => rail.locator(".ask-footer").evaluate(footer => {
  const bar = footer.querySelector(".ask-pack-bar");
  const composer = footer.querySelector(".ask-composer");
  if (!bar || !composer || bar.contains(composer) || composer.contains(bar)) return false;
  const strip = bar.getBoundingClientRect();
  const input = composer.getBoundingClientRect();
  const overlap = strip.bottom - input.top;
  return overlap >= 5 && overlap <= 9 && input.top - strip.top >= 38
    && strip.width < input.width && strip.height < input.height
    && getComputedStyle(bar).backgroundColor !== getComputedStyle(composer).backgroundColor;
});
const waitForUsageRing = percent => page.waitForFunction(value => {
  const meter = document.querySelector(".ask-meter");
  return meter && getComputedStyle(meter).getPropertyValue("--ask-remaining").trim() === value;
}, percent);
const send = async text => { await composer.fill(text); await composer.press("Enter"); };
const waitFocused = selector => page.waitForFunction(s => document.activeElement?.matches(s), selector);
const waitDocked = () => page.waitForFunction(() => {
  const box = selector => document.querySelector(selector)?.getBoundingClientRect();
  const rail = document.querySelector(".workspace-rail:not([hidden])");
  const dock = rail?.getBoundingClientRect(), main = box("main.content"), sidebar = box(".app-shell > .sidebar");
  const header = rail?.querySelector(".rail-header")?.getBoundingClientRect(), controls = box(".window-controls");
  return dock && main && sidebar && controls && main.left === sidebar.right
    && Math.abs(dock.left - main.right) < 1 && Math.abs(dock.right - innerWidth) < 1
    && dock.top === 0 && dock.bottom === innerHeight
    && (rail.classList.contains("workspace-rail-image") || (header && header.top >= controls.bottom));
});
try {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await rail.waitFor();
  await waitDocked();
  assert.equal(await page.locator(".ad-rail, .ad-placeholder, .ask-trigger").count(), 0);
  assert.equal(await page.getByRole("dialog", { name: "Alula" }).count(), 0);
  assert.equal(await rail.locator(".ask-header").getByRole("heading").innerText(), "Alula");
  assert.equal(await rail.locator(".ask-header").getByRole("heading").evaluate(el => getComputedStyle(el).fontSize), "20px");
  assert.equal(await rail.locator(".ask-header button, .ask-header .ask-brand-mark").count(), 0);
  assert.equal(await composer.evaluate(el => document.activeElement === el), false);
  await waitForUsageRing("80%");
  assert.ok(await rail.locator(".ask-meter").evaluate(el => {
    const box = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    return !!el.closest(".ask-footer .ask-tools") && box.width === 18 && box.height === 18
      && style.backgroundImage.startsWith("conic-gradient(") && style.maskImage.startsWith("radial-gradient(");
  }));
  assert.equal(await rail.locator(".ask-composer button").count(), 3);
  assert.ok(await checkPackBarPlacement());
  assert.equal(await packSelector.innerText(), "Select modpack");
  assert.equal(await rail.getByText("Shift + Enter for a new line", { exact: true }).count(), 0);
  assert.equal(await composer.getAttribute("placeholder"), "Ask Alula…");
  assert.equal(await composer.getAttribute("enterkeyhint"), "send");
  await capture("01-oled-welcome");
  await captureComposer("14-alula-folder-empty");

  await rail.getByRole("button", { name: "80% left today" }).click();
  await rail.getByText("Daily: 80%", { exact: false }).waitFor();
  await rail.getByText("Monthly: 98", { exact: false }).waitFor();
  await rail.getByText("Online replies use your question, any attached pack details, and up to two recent turns.").waitFor();
  await composer.press("Shift+Enter");
  assert.equal(await composer.inputValue(), "\n");
  await rail.getByRole("button", { name: "Where do I change memory allocation?" }).click();
  await rail.getByRole("button", { name: "Open Memory Settings" }).waitFor();
  assert.equal(calls.filter(call => call === "paid-attempt").length, 0);

  await page.evaluate(() => {
    const settings = JSON.parse(localStorage.getItem("bloom-settings"));
    localStorage.setItem("bloom-settings", JSON.stringify({ ...settings, rightSidebar: "Ask Delight" }));
  });
  await page.reload();
  await rail.getByText("Open Client settings", { exact: false }).waitFor();
  assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("bloom-settings")).rightSidebar), "Alula");
  await rail.getByRole("button", { name: "80% left today" }).waitFor();
  await send("My game runs smoothly until I turn on shaders. Should I give Minecraft more RAM, or try a lighter shader pack first?");
  const dots = rail.getByRole("status", { name: "Alula is thinking" });
  await dots.waitFor();
  assert.equal(await dots.innerText(), "");
  assert.equal(await dots.locator("i").count(), 3);
  const thinkingDot = rail.locator(".ask-thinking-dots i").first();
  assert.equal(await thinkingDot.evaluate(el => getComputedStyle(el).animationName), "ask-thinking-beat");
  await capture("01-alula-thinking");
  await page.emulateMedia({ reducedMotion: "reduce" });
  assert.equal(await thinkingDot.evaluate(el => getComputedStyle(el).animationName), "none");
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Instances", exact: true }).click();
  await page.getByRole("region", { name: "Instance library" }).waitFor();
  await waitDocked();
  await dots.waitFor();
  assert.equal(calls.filter(call => call === "paid-attempt").length, 1);
  await rail.locator(".ask-transcript").evaluate(node => {
    const observer = new MutationObserver(() => {
      const words = [...node.querySelectorAll(".ask-reveal-word")];
      if (!words.length) return;
      observer.disconnect();
      const animation = words[0].getAnimations()[0];
      animation.pause();
      animation.currentTime = 180;
      const accent = getComputedStyle(words[0]).color;
      const opacity = getComputedStyle(words[0]).opacity;
      animation.currentTime = 560;
      const settled = getComputedStyle(words[0]).color;
      animation.play();
      window.alulaArrival = { accent, opacity, settled, animation: getComputedStyle(words[0]).animationName, delays: words.map(word => parseFloat(word.style.animationDelay)), dots: node.querySelectorAll(".ask-thinking-dots").length };
    });
    observer.observe(node,{childList:true,subtree:true});
  });
  releaseAnswer();
  const arrival = await (await page.waitForFunction(() => window.alulaArrival)).jsonValue();
  assert.equal(arrival.animation,"ask-word-arrive");
  assert.equal(arrival.dots,0);
  assert.equal(arrival.opacity,"1");
  assert.notEqual(arrival.accent,arrival.settled);
  assert.ok(arrival.delays[1] === 48 && arrival.delays[2] === 96 && arrival.delays[3]-arrival.delays[2] > 120);
  await rail.getByText("For an existing instance", { exact: false }).waitFor();
  await waitForUsageRing("70%");

  await rail.getByRole("button", { name: "Open Memory Settings" }).last().click();
  await waitFocused('[data-ask-target="memory"] h2');
  await waitDocked();
  await rail.getByText("For an existing instance", { exact: false }).waitFor();
  await capture("02-settings-and-chat");

  await page.setViewportSize({ width: 900, height: 650 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await waitDocked();
  const compact = await rail.boundingBox();
  assert.ok(compact.width >= 220 && compact.width < 250);
  assert.ok(await checkPackBarPlacement());
  assert.ok(await rail.locator(".ask-composer-meta").evaluate(row => {
    const bounds = row.getBoundingClientRect();
    const tools = row.querySelector(".ask-tools").getBoundingClientRect();
    const hint = row.querySelector(".ask-enter-hint").getBoundingClientRect();
    return tools.right <= hint.left && hint.right <= bounds.right;
  }));
  await rail.getByRole("button", { name: "Open Memory Settings" }).last().click();
  await waitFocused('[data-ask-target="memory"] h2');
  assert.equal(await rail.locator(".ask-meter").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
  await rail.getByRole("button", { name: "70% left today" }).click();
  const popover = await rail.locator(".ask-usage-details").boundingBox();
  const toolbar = await rail.locator(".ask-tools").boundingBox();
  assert.ok(popover.x >= compact.x && popover.x + popover.width <= compact.x + compact.width);
  assert.ok(popover.y + popover.height < toolbar.y);
  await rail.getByRole("button", { name: "70% left today" }).click();
  const composerBox = await composer.boundingBox();
  assert.ok(composerBox.x >= compact.x && composerBox.y + composerBox.height <= compact.height);
  await capture("03-minimum-width");

  account = "minecraft-delight-b";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await rail.getByRole("heading", { name: "How can I help?" }).waitFor();
  assert.equal(await rail.getByText("For an existing instance", { exact: false }).count(), 0);
  account = "minecraft-delight-a";
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await rail.getByText("For an existing instance", { exact: false }).waitFor();

  await rail.getByRole("button", { name: "New chat" }).click();
  await send("shaders");
  await rail.getByText("Open an instance and select Shaders.", { exact: false }).waitFor();
  await rail.getByRole("button", { name: "Chat history" }).click();
  const recent = rail.getByRole("region", { name: "Recent chats" });
  await recent.getByRole("heading", { name: "Today" }).waitFor();
  assert.equal(await composer.count(), 0);
  await capture("03-alula-recent-chats");
  const search = recent.getByRole("searchbox", { name: "Search chat titles" });
  await search.fill("allocation");
  await recent.getByRole("button", { name: /^Where do I change memory allocation/ }).waitFor();
  assert.equal(await recent.getByRole("button", { name: /^shaders/ }).count(), 0);
  await search.fill("nothing matches this");
  await recent.getByText("No matching chats.").waitFor();
  await recent.getByRole("button", { name: "Back to chat" }).click();
  await composer.waitFor();
  await rail.getByRole("button", { name: "Chat history" }).click();
  await recent.getByRole("button", { name: /^Where do I change memory allocation/ }).click();
  await rail.getByText("For an existing instance", { exact: false }).waitFor();
  await rail.getByRole("button", { name: "Chat history" }).click();
  const shaderRow = recent.locator(".ask-history-row").filter({ has: page.getByRole("button", { name: /^shaders/ }) });
  await shaderRow.hover();
  await shaderRow.getByRole("button", { name: "Delete chat: shaders" }).click();
  await shaderRow.waitFor({ state: "detached" });
  await recent.getByRole("button", { name: "Manage", exact: true }).click();
  await rail.getByRole("button", { name: "Clear all history" }).click();
  await rail.getByRole("button", { name: "Delete all chats" }).click();
  await rail.getByText("No recent chats.").waitFor();
  await rail.getByRole("checkbox", { name: "Don’t save chats" }).check();
  await rail.getByRole("button", { name: "New chat" }).click();
  await send("memory");
  await rail.getByRole("button", { name: "Open Memory Settings" }).waitFor();
  await page.reload();
  await rail.getByRole("heading", { name: "How can I help?" }).waitFor();
  assert.equal(saved.get(account).threads.length, 0);
  await send("shaders");
  await rail.getByText("Open an instance and select Shaders.", { exact: false }).waitFor();
  assert.equal(await rail.getByRole("button", { name: "Go to Shaders" }).count(), 0);
  await page.getByRole("button", { name: "Open Survival" }).click();
  await page.getByRole("tab", { name: "Mods" }).waitFor();
  await rail.getByRole("button", { name: "Go to Shaders" }).click();
  await waitFocused('[data-ask-target="shaderpacks"][aria-selected="true"]');

  usageError = "not_found";
  await page.reload();
  await rail.getByRole("button", { name: "AI unavailable" }).waitFor();
  await send("My game runs smoothly until I turn on shaders. Should I give Minecraft more RAM, or try a lighter shader pack first?");
  await rail.getByText("AI answers aren’t available in this launcher environment yet. Local help still works.", { exact: true }).waitFor();
  assert.equal(calls.filter(call => call === "paid-attempt").length, 1);
  usageError = null;

  await page.setViewportSize({ width: 1500, height: 840 });
  await page.evaluate(() => {
    localStorage.setItem("ask-delight-fixture-theme", "light");
    localStorage.setItem("ask-delight-fixture-recommendations", "off");
  });
  await page.reload();
  await waitDocked();
  await waitForUsageRing("70%");
  await send("memory");
  await rail.getByRole("button", { name: "Open Memory Settings" }).waitFor();
  await capture("04-light");
  assert.ok(await checkPackBarPlacement());
  await captureComposer("15-alula-folder-light");

  await page.evaluate(() => {
    localStorage.setItem("ask-delight-fixture-theme", "oled");
  });
  await page.reload();
  await waitDocked();
  const openSidebarSettings = async () => {
    await page.getByRole("button", { name: "Edit", exact: true }).click();
    await page.getByRole("menuitem", { name: "Client settings" }).click();
    await page.locator(".settings-tabs").getByRole("button", { name: "Sidebar", exact: true }).click();
  };
  const selectSidebar = async choice => {
    await page.getByRole("button", { name: /^Right Sidebar:/ }).click();
    await page.locator(".select-menu-portal").getByRole("button", { name: choice, exact: true }).click();
  };
  await openSidebarSettings();
  const sidebarSetting = page.getByRole("button", { name: /^Right Sidebar:/ });
  await page.waitForFunction(() => {
    const bounds = document.querySelector('button[aria-label^="Right Sidebar:"]')?.getBoundingClientRect();
    return bounds && bounds.top >= 42 && bounds.bottom <= innerHeight;
  });
  assert.equal(await sidebarSetting.locator(".select-value").textContent(), "Alula");
  await capture("06-sidebar-settings");
  await selectSidebar("Download Queue");
  const downloads = page.getByRole("complementary", { name: "Download Queue" });
  await downloads.getByText("No active or queued downloads.").waitFor();
  await rail.waitFor({ state: "hidden" });
  await waitDocked();
  const assistantCalls = calls.filter(call => call.startsWith("ask_delight")).length;
  queue = [
    { id: "mod-one", title: "Sodium", category: "mods", instanceId: "example", instanceName: "Survival",
      version: "1.0", state: "installing", progress: 38, revision: 1 },
    { id: "shader-two", title: "Complementary", category: "shaderpacks", instanceId: "example", instanceName: "Survival",
      version: "1.0", state: "queued", progress: 0, revision: 2 },
  ];
  await page.reload();
  await downloads.getByRole("progressbar", { name: "Sodium progress" }).waitFor();
  await downloads.getByText("Queued", { exact: true }).waitFor();
  assert.equal(calls.filter(call => call.startsWith("ask_delight")).length, assistantCalls);
  await waitDocked();
  await capture("07-download-queue");
  await downloads.getByRole("button", { name: "Open Downloads" }).click();
  await page.getByRole("heading", { name: "Downloads", exact: true }).waitFor();

  await openSidebarSettings();
  await selectSidebar("Custom Image");
  const imageRail = page.getByRole("complementary", { name: "Custom Image" });
  const customImage = imageRail.getByRole("img", { name: "Custom sidebar image" });
  const chooseImage = page.getByRole("button", { name: "Choose Image", exact: true });
  await chooseImage.waitFor();
  await imageRail.getByText("Choose an image in Settings → Sidebar.").waitFor();
  assert.equal(await imageRail.locator("button").count(), 0);
  const [initialFile] = await Promise.all([page.waitForEvent("filechooser"), chooseImage.click()]);
  await initialFile.setFiles("public/minecraft-default-server.png");
  await customImage.waitFor();
  await page.reload();
  await customImage.waitFor();
  assert.ok(await customImage.evaluate(img => img.decode().then(() => img.naturalWidth > 0)));
  await waitDocked();
  const assertImageFill = async () => assert.ok(await customImage.evaluate(img => {
    const imageBox = img.getBoundingClientRect();
    const railBox = img.closest("aside").getBoundingClientRect();
    const close = document.querySelector(".window-close");
    const closeBox = close.getBoundingClientRect();
    return getComputedStyle(img).objectFit === "cover" && imageBox.top === railBox.top
      && imageBox.bottom === railBox.bottom && Math.abs(imageBox.left - railBox.left) <= 1
      && imageBox.right === railBox.right
      && document.elementFromPoint(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2)?.closest("button") === close;
  }));
  await assertImageFill();
  assert.equal(await imageRail.getByRole("heading").count(), 0);
  await imageRail.hover();
  assert.equal(await imageRail.locator("button, input, .sidebar-image-tools").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Switch Image", exact: true }).count(), 0);
  await capture("08-custom-image");
  await page.setViewportSize({ width: 900, height: 640 });
  await waitDocked();
  await assertImageFill();
  await page.setViewportSize({ width: 1500, height: 840 });
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await openSidebarSettings();
  const preview = page.getByRole("group", { name: "Sidebar image controls" });
  const previewImage = preview.getByRole("img", { name: "Sidebar image preview" });
  const switchImage = preview.getByRole("button", { name: "Switch Image" });
  const adjustCrop = preview.getByRole("button", { name: "Adjust Crop" });
  const removeImage = preview.getByRole("button", { name: "Remove Image", exact: true });
  await previewImage.waitFor();
  assert.ok(await preview.evaluate(el => el.clientHeight > el.clientWidth));
  const switchBounds = await switchImage.boundingBox();
  const cropBounds = await adjustCrop.boundingBox();
  const removeBounds = await removeImage.boundingBox();
  assert.equal(switchBounds.x, cropBounds.x);
  assert.ok(switchBounds.y < cropBounds.y && cropBounds.y < removeBounds.y);
  assert.equal(await removeImage.innerText(), "");
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".sidebar-image-tools")).opacity === "0");
  await preview.hover();
  await switchImage.hover();
  const waitForDivider = y => page.waitForFunction(offset => {
    const divider = document.querySelector(".sidebar-image-divider");
    return divider.offsetWidth > divider.offsetHeight && new DOMMatrix(getComputedStyle(divider).transform).m42 === offset;
  }, y);
  await waitForDivider(22);
  await adjustCrop.hover();
  await waitForDivider(-22);
  await capture("08-custom-image-hover");
  await adjustCrop.click();
  const cropDialog = page.getByRole("dialog", { name: "Adjust Sidebar Image" });
  await cropDialog.waitFor();
  const stage = cropDialog.locator(".sidebar-crop-stage");
  const stageImage = stage.locator("img");
  const originalWidth = await stageImage.evaluate(img => img.getBoundingClientRect().width);
  const stageBox = await stage.boundingBox();
  const center = { x: stageBox.x + stageBox.width / 2, y: stageBox.y + stageBox.height / 2 };
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -170);
  await page.waitForFunction(width => document.querySelector(".sidebar-crop-stage img").getBoundingClientRect().width > width + 10, originalWidth);
  const zoomedWidth = await stageImage.evaluate(img => img.getBoundingClientRect().width);
  await page.mouse.wheel(0, 40);
  await page.waitForFunction(width => document.querySelector(".sidebar-crop-stage img").getBoundingClientRect().width < width - 10, zoomedWidth);
  const originalLeft = await stageImage.evaluate(img => img.style.left);
  await page.mouse.down();
  await page.mouse.move(center.x + 50, center.y - 20, { steps: 5 });
  await page.mouse.up();
  assert.notEqual(await stageImage.evaluate(img => img.style.left), originalLeft);
  await capture("08-custom-image-crop");
  await cropDialog.getByRole("button", { name: "Apply", exact: true }).click();
  await cropDialog.waitFor({ state: "hidden" });
  const cropStyle = img => [getComputedStyle(img).scale, img.style.objectPosition];
  const updatedCrop = await customImage.evaluate(cropStyle);
  assert.ok(Number(updatedCrop[0]) > 1 && updatedCrop[1] !== "50% 50%");
  assert.deepEqual(await previewImage.evaluate(cropStyle), updatedCrop);
  await page.reload();
  await customImage.waitFor();
  assert.deepEqual(await customImage.evaluate(cropStyle), updatedCrop);
  await openSidebarSettings();
  await previewImage.waitFor();
  await preview.hover();
  await adjustCrop.hover();
  await adjustCrop.click();
  await cropDialog.getByRole("button", { name: "Reset", exact: true }).click();
  await page.keyboard.press("Escape");
  await cropDialog.waitFor({ state: "hidden" });
  assert.deepEqual(await customImage.evaluate(cropStyle), updatedCrop);
  const originalSource = await customImage.getAttribute("src");
  await switchImage.hover();
  const [replacement] = await Promise.all([page.waitForEvent("filechooser"), switchImage.click()]);
  await replacement.setFiles("public/delight-logo.png");
  await page.waitForFunction(source => {
    const img = document.querySelector(".workspace-rail-image > img");
    return img?.complete && img.naturalWidth > 0 && img.getAttribute("src") !== source;
  }, originalSource);
  assert.deepEqual(await customImage.evaluate(cropStyle), ["1", "50% 50%"]);
  await preview.hover();
  await removeImage.click();
  await chooseImage.waitFor();
  await page.reload();
  await imageRail.getByText("Choose an image in Settings → Sidebar.").waitFor();
  assert.equal(await customImage.count(), 0);

  await openSidebarSettings();
  await selectSidebar("Friends");
  const friends = page.getByRole("complementary", { name: "Friends" });
  await friends.getByRole("button", { name: "Message Morgan" }).waitFor();
  await page.locator(".sidebar nav").getByRole("button", { name: "Home", exact: true }).click();
  await waitDocked();
  await capture("09-friends");
  await friends.getByRole("button", { name: "Message Morgan" }).click();
  await page.getByPlaceholder("Message @mo", { exact: true }).waitFor();
  await friends.getByRole("button", { name: "Open Social" }).click();
  await page.getByPlaceholder("Enter an exact Delight account username").waitFor();
  socialSignedIn = false;
  await page.evaluate(() => window.dispatchEvent(new Event("delight-social-directory-changed")));
  await friends.getByText("Sign in to Delight to see your friends.", { exact: true }).waitFor();
  assert.equal(await friends.getByRole("button", { name: "Message Morgan" }).count(), 0);

  await openSidebarSettings();
  await selectSidebar("Hidden");
  await friends.waitFor({ state: "hidden" });
  await page.reload();
  assert.equal(await page.locator(".workspace-rail:visible").count(), 0);
  await page.waitForFunction(() => Math.abs(document.querySelector("main.content")?.getBoundingClientRect().right - innerWidth) < 1);
  assert.equal(calls.filter(call => call.startsWith("ask_delight")).length, assistantCalls);
  await capture("10-hidden");

  await openSidebarSettings();
  await selectSidebar("Alula");
  await rail.getByRole("textbox", { name: "Your question" }).waitFor();
  await waitDocked();
  await rail.getByRole("button", { name: "New chat" }).click();
  const attemptsBeforeFollowups = calls.filter(call => call === "paid-attempt").length;
  await send(irisQuestion);
  await rail.getByText(versionQuestion, { exact: true }).waitFor();
  await rail.getByRole("button",{name:"Type my own answer"}).click();
  assert.ok(await composer.evaluate(el=>el === document.activeElement));
  await send("minecraft 26.3");
  await rail.getByText(loaderQuestion, { exact: true }).waitFor();
  await rail.locator(".ask-transcript").evaluate(node => {
    const observer = new MutationObserver(() => {
      const link = node.querySelector("a.ask-source[data-reveal-at]");
      const item = link?.closest("article")?.querySelector("li[data-reveal-at]");
      if (!link || !item) return;
      observer.disconnect();
      window.sourceReveal = [item,link].map(el => ({
        delay:Number(el.dataset.revealAt), opacity:getComputedStyle(el).opacity,
        first:parseFloat(el.querySelector(".ask-reveal-word").style.animationDelay),
      }));
    });
    observer.observe(node,{childList:true,subtree:true});
  });
  await rail.getByRole("button",{name:"Fabric",exact:true}).click();
  const releaseLink = rail.getByRole("link", { name: "View on Modrinth" });
  await releaseLink.waitFor();
  const [bullet,source] = await (await page.waitForFunction(() => window.sourceReveal)).jsonValue();
  assert.ok(bullet.delay > 0 && source.delay > bullet.delay);
  for (const part of [bullet,source]) {
    assert.equal(part.opacity,"0");
    assert.equal(part.delay,part.first);
  }
  assert.equal(await rail.locator(".ask-markdown strong").last().innerText(),"Latest stable Iris");
  await rail.getByRole("listitem").filter({hasText:"Verified file"}).waitFor();
  assert.equal(await rail.getByRole("group",{name:"Reply to Alula"}).count(),0);
  assert.equal(await releaseLink.getAttribute("href"), "https://modrinth.com/mod/iris/version/vTN4NRGW");
  await releaseLink.click();
  assert.ok(calls.includes("plugin:opener|open_url"));
  assert.equal(calls.filter(call => call === "paid-attempt").length - attemptsBeforeFollowups, 3);
  await rail.getByRole("button", {name:"New chat"}).click();
  await send("Build a Fabric 1.21.1 performance modpack");
  await rail.getByText("Sodium",{exact:true}).waitFor();
  await send("Add Lithium");
  await rail.getByText("Lithium",{exact:true}).waitFor();
  assert.ok(!calls.includes("create_alula_instance"));
  await rail.getByRole("button",{name:"Create instance"}).last().click();
  await rail.getByRole("button",{name:"Queuing mods · 1 of 2"}).waitFor();
  await rail.getByRole("button",{name:"Open Downloads"}).click();
  await page.getByRole("heading",{name:"Downloads",exact:true}).first().waitFor();
  assert.equal(calls.filter(c=>c==="create_alula_instance").length,1);
  assert.equal(calls.filter(c=>c==="install_modrinth_content").length,2);
  await packSelector.click();
  await rail.getByRole("region", {name:"Choose pack context"}).getByRole("button", {name:/Fast.*Alula draft/}).click();
  await packBar.getByRole("button", {name:"Preview pack context"}).dblclick();
  await rail.getByRole("region", {name:"Review pack context"}).getByText(/Draft mods/).waitFor();
  await send("What’s the purpose of Lithium?");
  await rail.getByText("Lithium is in this performance draft.", {exact:true}).waitFor();
  await rail.getByRole("button",{name:"New chat"}).click();
  assert.equal(await rail.getByRole("button", {name:"Remove pack context"}).count(), 0);
  await page.getByRole("button", { name: "Open Survival" }).click();
  await send("How do I change this instance's RAM?");
  await rail.getByRole("button",{name:"Open instance memory"}).click();
  await waitFocused('input[aria-label="Minecraft memory"]');
  await send("Where do I switch accounts?");
  await rail.getByRole("button",{name:"Open accounts"}).click();
  await waitFocused(".profile-account-picker button");
  await rail.getByRole("button",{name:"Open instance memory"}).click();
  await waitFocused('input[aria-label="Minecraft memory"]');
  await rail.getByRole("button", {name:"New chat"}).click();
  const requestsBeforeAttachment = chatRequests.length;
  await packSelector.click();
  const instanceOption = rail.getByRole("region", {name:"Choose pack context"}).getByRole("button", {name:/Survival/});
  assert.ok(await instanceOption.evaluate(el=>el === document.activeElement));
  await capture("12-pack-folder-picker");
  await instanceOption.press("Enter");
  await packBar.getByRole("button", {name:"Preview pack context"}).dblclick();
  await rail.getByRole("region", {name:"Review pack context"}).getByText(/Sodium 0\.6\.13/).waitFor();
  assert.equal(await packSelector.innerText(), "Survival");
  assert.equal(chatRequests.length, requestsBeforeAttachment);
  await packBar.getByRole("button", {name:"Preview pack context"}).dblclick();
  await rail.getByRole("region", {name:"Review pack context"}).waitFor({state:"hidden"});
  await capture("13-selected-pack-bar");
  await captureComposer("16-alula-folder-selected");
  await packBar.getByRole("button", {name:"Preview pack context"}).dblclick();
  await rail.getByRole("region", {name:"Review pack context"}).waitFor();
  await send("Which mods would you replace?");
  await rail.getByText("Consider replacing a mod from Survival.", {exact:true}).waitFor();
  await rail.getByRole("button", {name:"Remove pack context"}).click();
  assert.equal(await packSelector.innerText(), "Select modpack");
  await send("Tell me about this instance");
  await rail.getByText("No pack was attached.", {exact:true}).waitFor();
  console.log("Right sidebar browser checks passed, including installed and draft pack context, review before send, context removal, and the request size limit.");
} catch (error) {
  console.error("Active element:", await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 240)));
  await capture("failure");
  throw error;
} finally { await browser.close(); }
