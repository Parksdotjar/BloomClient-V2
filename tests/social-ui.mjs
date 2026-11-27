// Exercise the production Social routes against an isolated native bridge.
import assert from "node:assert/strict";
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
const page = await browser.newPage({ viewport: { width: 1100, height: 740 }, deviceScaleFactor:Number(process.env.SOCIAL_TEST_DPR || 1) });
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";
const errors = [];
page.setDefaultTimeout(8000);
page.on("pageerror", error => errors.push(error.message));
await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  const user = id => ({ id, username: id, displayName: id, avatarUrl: null });
  const self = user("tester"), friend = user("Alex"), guest = user("Morgan");
  friend.minecraftUuid = "12345678123412341234123456789abc";
  window.portraitRequests = 0;
  const session = { signedIn: true, user: self, needsUsername: false };
  const state = { session, friends: [friend], requests: { incoming: [guest], outgoing: [] },
    conversations: [{ id: "dm", friend, updatedAt: 10 }],
    groups: [{ id: "crew", name: "Build crew", updatedAt: 5, ownerId: self.id, canManage: true, members: [self, friend] }],
    invites: [{ id: "invite", recipient: self, sender: friend, instanceName: "Meadow", minecraftVersion: "1.21", loader: "Fabric", status: "pending", createdAt: 1 }],
    messages: [], syncWarning: null };
  let party;
  let callback = 0;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return ++callback; }, unregisterCallback() {}, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      if (command === "get_minecraft_skin") {window.portraitRequests++; return "fixture-skin";}
      if (command === "get_cached_thumbnail") return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/aXkAAAAASUVORK5CYII=";
      if (command === "social_party") {
        if (!args.change && window.holdPartyRead) await new Promise(resolve=>{window.releasePartyRead=resolve;});
        if (args.change?.action === "create") party = {id:"party", host:self.id, server:"", members:[{id:"quiet",name:"Quiet"},{id:"visiting",name:"Another",server:"play.example.net"},{id:self.id,name:"tester"}], invited:[]};
        if (args.change?.action === "share") party.members.find(m=>m.id===self.id).server="shared.example.net";
        if (args.change?.action === "stop") party.members.find(m=>m.id===self.id).server=null;
        if (args.change?.action === "invite") party.invited.push(args.change.friendId);
        if (args.change?.action === "leave") party = undefined;
        return structuredClone({party, invites:[],currentServer:{server:"shared.example.net",visit:"fixture"}});
      }
      if (command === "social_session_state") return session;
      if (command === "social_wait_for_updates") return new Promise(() => {});
      if (command === "social_encryption_details") return {
        friendId: args.friendId, status: "not_verified", firstSeenAt: Date.now(), friendDeviceCount: 1,
        safetyNumber: "01234 56789", qrPayload: "fixture-identity"
      };
      if (command === "social_snapshot") return structuredClone(state);
      if (command === "social_send_message" || command === "social_send_group_message") {
        const message = { id: String(state.messages.length + 1), senderId: self.id, kind: "message", text: args.text,
          friendId: args.friendId, groupId: args.groupId || null, createdAt: Date.now(), deliveryState: "sent" };
        state.messages.push(message);
        return message;
      }
      if (command === "social_sync_messages") return { messages: state.messages, syncWarning: null };
      if (command === "social_decline_instance_invite") {
        assertInvite(args.inviteId); state.invites[0].status = "declined"; return structuredClone(state);
      }
      if (command === "social_accept_friend_request") {
        if (args.userId !== guest.id) throw Error("Unknown request");
        state.requests.incoming = []; state.friends.push(guest); return structuredClone(state);
      }
      if (command === "list_minecraft_accounts") return { accounts: [], activeId: null };
      if (command === "list_instances") return [{id:"survival",name:"Survival",visible:true,version:"1.21.1",loader:"Fabric"}];
      if (command === "list_pack_channel_memberships") return [];
      if (command === "launch_minecraft") { window.fixtureLaunch = args; return; }
      if (command === "plugin:event|listen") return ++callback;
      if (command === "plugin:app|version") return "1.1.8";
      if (command === "get_minecraft_launch_status") return { active: false };
      return null;
    },
  };
  function assertInvite(id) { if (id !== "invite") throw Error("Unknown invite"); }
});
try {
  await page.goto(url);
  const social = page.locator(".social-dock-tab");
  const workspace = page.locator("main[data-desktop-page]");
  const underlying = await workspace.getAttribute("data-desktop-page");
  const workspaceBounds = await workspace.boundingBox();
  await social.hover();
  const panel = page.locator("#social-dock-panel");
  const main = panel.locator(".social-main");
  await main.getByRole("button",{name:"Create party"}).waitFor();
  await page.mouse.move(4,100);
  await page.waitForTimeout(320);
  assert.equal(await social.getAttribute("aria-expanded"),"true");
  await workspace.click({position:{x:15,y:120}});
  assert.equal(await social.getAttribute("aria-expanded"),"false");
  await social.focus();
  await page.keyboard.press("Enter");
  const sidebar = main.locator(".social-rail");
  const views = panel.getByRole("navigation", {name:"Social views"});
  await main.getByRole("button",{name:"Create party"}).click();
  await page.waitForFunction(() => {
    const panel = document.querySelector("#social-dock-panel");
    const rect = panel.getBoundingClientRect();
    return getComputedStyle(panel.closest(".social-dock")).transform === "none" && Math.abs(rect.right - innerWidth) < 1 &&
      [0.2,0.5,0.8].every(y => panel.contains(document.elementFromPoint(rect.left + 100, rect.top + rect.height*y)));
  });
  assert.equal(await main.getByLabel("Server address").count(),0);
  async function verifyPendingRoster(open) {
    await page.evaluate(()=>{window.holdPartyRead=true;window.releasePartyRead=null;});
    await open();
    await main.locator(".party-roster").waitFor();
    await page.waitForFunction(()=>typeof window.releasePartyRead==="function");
    assert.equal(await main.getByRole("button",{name:"Create party"}).count(),0);
    await page.evaluate(()=>{window.holdPartyRead=false;window.releasePartyRead();});
    await main.getByRole("button",{name:"End party"}).waitFor();
  }
  await views.getByRole("button",{name:"Friends",exact:true}).click();
  await verifyPendingRoster(()=>views.getByRole("button",{name:"Party",exact:true}).click());
  await workspace.click({position:{x:15,y:120}});
  await panel.locator(".social-page").waitFor({state:"detached"});
  await verifyPendingRoster(()=>social.hover());
  await main.getByRole("button",{name:"Invite players"}).click();
  await main.getByRole("button",{name:"Invite Alex"}).click();
  const acknowledged = main.getByRole("button",{name:"Invited",exact:true});
  await acknowledged.waitFor();
  assert.equal((await acknowledged.innerText()).trim(),"");
  assert.ok(await acknowledged.isDisabled());
  assert.equal(await acknowledged.locator(".invite-check").count(),1);
  await main.getByRole("dialog",{name:"Invite players"}).waitFor();
  await main.getByRole("button",{name:"Invite players",exact:true}).click();
  const host=main.locator(".party-player").first();
  await host.getByAltText("Party host").waitFor();
  assert.equal(await main.locator(".party-player").filter({hasText:"Quiet"}).getByRole("button").count(),0);
  await host.getByRole("button",{name:"Share",exact:true}).click();
  await host.getByText("shared.example.net",{exact:true}).waitFor();
  const stopSharing = host.getByRole("button",{name:"Stop sharing"});
  await page.mouse.move(0,0);
  const actionColors = button => [getComputedStyle(button).backgroundColor, getComputedStyle(button).color, getComputedStyle(button).borderTopWidth];
  assert.deepEqual(await stopSharing.evaluate(actionColors), ["rgb(207, 38, 51)", "rgb(255, 255, 255)", "0px"]);
  await stopSharing.click();
  assert.equal(await page.evaluate(() => window.fixtureLaunch),undefined);
  const joinServer = main.getByRole("button",{name:"Join",exact:true});
  assert.deepEqual(await joinServer.evaluate(actionColors), ["rgb(117, 171, 11)", "rgb(255, 255, 255)", "0px"]);
  await joinServer.click();
  await page.waitForFunction(() => !!window.fixtureLaunch);
  const launched = await page.evaluate(() => window.fixtureLaunch);
  assert.equal(launched.instanceId, "survival");
  assert.deepEqual(launched.portalTarget, {kind:"server",target:"play.example.net"});
  await main.getByRole("button",{name:"End party"}).click();
  await main.getByRole("button",{name:"Create party"}).waitFor();
  await views.getByRole("button",{name:"Messages", exact:true}).click();
  assert.equal(await main.getByRole("button",{name:"Back to conversations"}).count(),0);
  await sidebar.getByRole("button",{name:/Alex/}).click();
  await main.getByPlaceholder("Message @Alex").waitFor();
  assert.deepEqual(await workspace.boundingBox(), workspaceBounds);
  assert.equal(await workspace.getAttribute("data-desktop-page"), underlying);
  const neutralSurfaces = async (selectors, mode) => {
    const issues = await page.evaluate(({ selectors, mode }) => {
      const sample = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
      document.documentElement.dataset.theme = mode;
      return selectors.flatMap(selector => {
        const element = document.querySelector(selector);
        if (!element) return [selector + " missing"];
        const style = getComputedStyle(element);
        const errors = [];
        for (const property of ["backgroundColor", "borderTopColor", "color"]) {
          sample.clearRect(0, 0, 1, 1);
          sample.fillStyle = style[property];
          sample.fillRect(0, 0, 1, 1);
          const [r, g, b, alpha] = sample.getImageData(0, 0, 1, 1).data;
          if (alpha && (r !== g || g !== b)) errors.push(selector + " " + property + " " + style[property]);
        }
        if (style.backgroundImage !== "none") errors.push(selector + " background image");
        return errors;
      });
    }, { selectors, mode });
    assert.deepEqual(issues, [], mode + ": " + issues.join(", "));
  };
  await main.getByRole("button", { name: "Encryption", exact: true }).click();
  await main.getByRole("img", { name: "Encryption safety number QR code" }).waitFor();
  for (const mode of ["light", "oled"]) {
    await neutralSurfaces([".social-encryption", ".social-encryption-drawer", ".social-security-status",
      ".social-security-code", ".social-security-qr", ".social-security-actions .scan"], mode);
  }
  await main.locator(".social-encryption-drawer header button").click();
  const send = async (placeholder, text) => {
    const composer = main.getByPlaceholder(placeholder);
    const field = main.locator(".social-compose-field");
    const fieldBounds = await field.boundingBox();
    const textBounds = await composer.boundingBox();
    const emoji = await field.getByRole("button",{name:"Add emoji"}).boundingBox();
    assert.ok(textBounds.x + textBounds.width <= emoji.x + 1);
    await composer.fill("line one\nline two\nline three");
    assert.ok((await field.boundingBox()).height > fieldBounds.height + 20);
    assert.equal(await field.getByRole("button",{name:"Send message"}).count(),1);
    if (placeholder === "Message @Alex") assert.equal(await field.getByRole("button",{name:"Attach encrypted screenshot"}).count(),0);
    await composer.fill(text);
    await composer.press("Enter");
    const sent = main.locator(".social-message.sent").filter({ hasText: text });
    await sent.waitFor();
    await sent.focus();
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Edit message" }).waitFor();
    for (const mode of ["light", "oled"]) await neutralSurfaces([".social-message-context"], mode);
    await page.keyboard.press("Escape");
  };
  await send("Message @Alex", "Direct fixture");
  await main.getByRole("button",{name:"Back to conversations"}).click();
  const search = sidebar.getByRole("searchbox");
  await search.fill("crew");
  assert.equal(await sidebar.locator(".social-friend-row").count(), 0);
  await sidebar.getByRole("button", { name: /Build crew/ }).click();
  await main.getByPlaceholder("Message Build crew").waitFor();
  await send("Message Build crew", "Group fixture");
  await main.getByRole("button", { name: "Add emoji" }).click();
  await main.locator(".social-emoji-picker").waitFor();
  await page.keyboard.press("Escape");
  await main.locator(".social-emoji-picker").waitFor({ state: "hidden" });
  await page.setViewportSize({ width: 920, height: 640 });
  await main.getByRole("button", { name: "Members", exact: true }).click();
  await main.getByRole("button", { name: "Actions for Alex" }).click();
  const memberMenu = page.getByRole("group", { name: "Actions", exact: true });
  for (const mode of ["light", "oled"]) await neutralSurfaces([".social-person-popup"], mode);
  const bounds = await memberMenu.boundingBox();
  assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 920 && bounds.y + bounds.height <= 640);
  await page.keyboard.press("Escape");
  await memberMenu.waitFor({ state: "hidden" });
  await main.getByRole("button", { name: "Close", exact: true }).click();
  assert.equal(await sidebar.locator(".social-account-trigger").count(), 0);
  await main.getByRole("button",{name:"Back to conversations"}).click();
  assert.equal(await sidebar.getByRole("searchbox").inputValue(),"crew");
  await views.getByRole("button", { name: /^Friends/ }).click();
  await main.locator(".social-add-friend input").focus();
  for (const mode of ["light", "oled"]) await neutralSurfaces([".social-add-friend", ".social-add-friend input", ".social-add-friend button"], mode);
  await main.getByRole("button", { name: "Actions for Alex" }).click();
  await page.getByRole("button", { name: "Open direct message" }).click();
  await main.getByPlaceholder("Message @Alex").waitFor();
  await views.getByRole("button", { name: /^Inbox/ }).click();
  await main.getByText("Friend requests", { exact: true }).waitFor();
  await main.getByText("Instance invites", { exact: true }).waitFor();
  await main.getByRole("button", { name: "Decline invite" }).click();
  await main.getByText("Declined", { exact: true }).waitFor();
  await main.getByRole("button", { name: "Accept", exact: true }).click();
  await views.getByRole("button", { name: "Inbox", exact: true }).waitFor();
  await views.getByRole("button",{name:"Party"}).click();
  await main.getByRole("heading",{name:"Party roster",exact:true}).waitFor();
  await workspace.evaluate(el => el.addEventListener("click", () => { el.dataset.receivedOutsideClick = "yes"; }, {once:true}));
  await workspace.click({position:{x:15,y:120}});
  assert.equal(await workspace.getAttribute("data-received-outside-click"),"yes");
  assert.equal(await social.getAttribute("aria-expanded"),"false");
  assert.equal(await workspace.getAttribute("data-desktop-page"),underlying);
  assert.equal(await main.locator(".social-rail").count(), 0);
  assert.equal(await page.evaluate(()=>window.portraitRequests),3);
  assert.deepEqual(errors, []);
  console.log("Social navigation, conversations, menus, requests and invites passed.");
} finally { await browser.close(); }
