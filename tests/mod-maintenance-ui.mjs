// Renderer regression against Vite. Native commands use a disposable instance library.
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";

function mockNative({ theme, duplicateFixture = false }) {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  if (!localStorage.getItem("bloom-settings")) {
    localStorage.setItem("bloom-settings", JSON.stringify({
      theme, animations: false, redesignAppearanceV1: true,
    }));
  }

  const instances = [
    { id: "meadow", name: "Meadow" },
    { id: "river", name: "River" },
  ].map(item => ({
    ...item, loader: "Fabric", version: "1.21.1", directory: item.name,
    java: "Automatic", memory: 4096, jvmArguments: "", visible: true,
    mods: true, config: true, resourcePacks: true, shaderPacks: true,
  }));
  const mod = (name, fileName, version) => ({ id: fileName, name, fileName, version, enabled: true, size: 2048 });
  const disabled = { ...mod("Local HUD", "local-hud.jar.disabled", "1.0"), enabled: false };
  const sodium = mod("Sodium", "sodium.jar", "0.9.2");
  const files = {
    meadow: [mod("FerriteCore", "ferritecore.jar", "7.0.2"), sodium, disabled],
    river: [mod("Explorer HUD", "explorer-hud.jar", "1.0")],
  };
  if (duplicateFixture) {
    files.river.push(...Array.from({ length: 55 }, (_, index) => mod(`A mod ${index}`, `a-${index}.jar`, "1.0")));
    files.river.push(mod("Fabric API", "fabric-api-old.jar", "1.0"), mod("Fabric API", "fabric-api-new.jar", "2.0"));
  }
  const conflict = {
    modId: "fabric-api", name: "Fabric API",
    candidates: [{ fileName: "fabric-api-old.jar", sha512: "1".repeat(128) }, { fileName: "fabric-api-new.jar", sha512: "2".repeat(128) }],
  };
  const conflicts = id => duplicateFixture && id === "river" && files.river.some(file => file.fileName === "fabric-api-old.jar") ? [conflict] : [];
  const archiveOld = () => { files.river = files.river.filter(file => file.fileName !== "fabric-api-old.jar"); };
  const test = window.modMaintenanceTest = {
    calls: [], updated: false, repaired: false, releaseApply: null, releaseRepair: null, failRiverCheck: false,
    repairNeedsEnable: false, releaseUpdateCheck: null, gameRunning: false,
    holdFirstInventory: true, releaseInventory: null, inventoryRead: false, failInventoryRefresh: false,
    scopedCheckError: "",
  };
  let next = 1;
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback() { return next++; },
    unregisterCallback() {},
    convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      test.calls.push({ command, args });
      switch (command) {
        case "get_notifications": return conflicts("river").length ? [{
          id: "duplicate-fixture", kind: "modUpdateFailed", modId: "fabric-api", instanceId: "river",
          instanceName: "River", createdAt: Date.now(), available: true, read: false, required: false,
        }] : [];
        case "check_mod_duplicates": return { conflicts: conflicts(args.instanceId), archived: 0, restorableFiles: [] };
        case "choose_mod_version":
          assertChosen(args);
          archiveOld();
          return { conflicts: [], archived: 1, restorableFiles: ["fabric-api-new.jar"] };
        case "keep_newest_mod_versions":
          archiveOld();
          return { archived: 1, remaining: 0, errors: [] };
        case "list_instances": return instances;
        case "get_minecraft_releases": return [{ id: "1.21.2" }, { id: "1.21.1" }];
        case "preview_minecraft_mod_update": return {
          token: "version-update", target: args.target, loaderVersion: "0.16.10", backsUpWorlds: true, issues: [],
          changes: [
            { kind: "remove", name: "Old Renderer", detail: "No supported Fabric release." },
            { kind: "dependency", name: "New Library", detail: "1.0" },
          ],
        };
        case "apply_minecraft_mod_update": {
          const instance = instances.find(item => item.id === args.instanceId);
          Object.assign(instance, { version: args.target, loaderVersion: "0.16.10" });
          return instance;
        }
        case "get_cached_instance_content": return args.category === "mods" ? files[args.instanceId] : null;
        case "list_instance_content":
          if (test.updated && test.failInventoryRefresh && args.category === "mods" && args.instanceId === "meadow") {
            throw new Error("Could not refresh the Mods list.");
          }
          if (test.holdFirstInventory && args.category === "mods" && args.instanceId === "meadow") {
            test.holdFirstInventory = false;
            await new Promise(resolve => { test.releaseInventory = resolve; });
            test.inventoryRead = true;
          }
          return args.category === "mods" ? files[args.instanceId] : [];
        case "toggle_instance_content":
          if (args.fileName === disabled.fileName) throw new Error("Local HUD requires a dependency Delight could not identify.");
          throw new Error("Unexpected content toggle");
        case "check_followed_pack_update": return null;
        case "check_mod_maintenance": {
          if (args.instanceId === "meadow" && test.updated && !test.releaseUpdateCheck) {
            await new Promise(resolve => { test.releaseUpdateCheck = resolve; });
          }
          if (args.instanceId === "river" && test.scopedCheckError) throw new Error(test.scopedCheckError);
          if (args.instanceId === "river" && test.failRiverCheck) {
            throw new Error("The mod catalog is temporarily unavailable.");
          }
          const update = args.instanceId === "meadow" && !test.updated;
          const repair = args.instanceId === "river" && !test.repaired;
          return {
            updates: update ? [{
              fileName: "ferritecore.jar", title: "FerriteCore", fromVersion: "7.0.2", toVersion: "7.0.3",
            }] : [],
            repairsAvailable: repair && !test.repairNeedsEnable,
            dependencyIssues: repair && test.repairNeedsEnable ? ["Fabric API is disabled. It was left disabled."] : [],
            issues: repair ? [{ fileName: "explorer-hud.jar", message: "Explorer HUD requires Fabric API." }]
              : update ? [
                { fileName: "ferritecore.jar", kind: "update", message: "Iris still requires the installed version." },
                { fileName: "ferritecore.jar", kind: "catalog", message: "Catalog could not verify this file for Minecraft 1.21.1." },
              ] : [],
            complete: true,
          };
        }
        case "update_instance_mods":
          if (test.gameRunning) throw new Error("Mods must wait for Minecraft to close.");
          if (args.instanceId === "meadow" && !test.updated) {
            await new Promise(resolve => { test.releaseApply = resolve; });
            test.updated = true;
            files.meadow = [
              mod("FerriteCore", "ferritecore-updated.jar", "7.0.3"),
              mod("New Requirement", "new-requirement.jar", "1.2"),
              sodium,
              disabled,
            ];
            return { applied: true, skipped: [{
              fileName: "sodium.jar", kind: "update", message: "Update skipped. An installed addon needs its current Sodium version.",
            }] };
          }
          if (args.instanceId === "river" && !test.repaired) {
            if (test.repairNeedsEnable) return { applied: false, skipped: [] };
            await new Promise(resolve => { test.releaseRepair = resolve; });
            test.repaired = true;
            files.river = [...files.river, mod("Fabric API", "fabric-api.jar", "0.116.7")];
            return { applied: true, skipped: [] };
          }
          return { applied: false, skipped: [] };
        case "get_global_file_sync_state": return {
          settings: {
            optionsSource: null, serversSource: null, voiceChatSource: null,
            voiceChatTargets: [], shareResourcePacks: false, shareShaderPacks: false,
          },
          statuses: [], backupRoot: "",
        };
        case "list_minecraft_accounts": return { activeId: null, accounts: [] };
        case "list_portal": return { entries: [], warnings: [] };
        case "get_content_download_queue": return { revision: 0, tasks: [] };
        case "get_minecraft_launch_status": return { active: false, progress: 0, state: "idle", message: "" };
        case "get_client_cache_settings": return { enabled: true, maxBytes: 3e9 };
        case "get_minecraft_process_running": return test.gameRunning;
        case "plugin:window|is_maximized": return false;
        case "take_workspace_player_links":
        case "list_instance_folders":
        case "list_pack_channel_memberships":
        case "list_cached_screenshots":
        case "list_managed_java_runtimes":
        case "reconcile_cosmetics": return [];
        case "plugin:event|listen": return next++;
        case "plugin:app|version": return "1.3.2";
        default: return null;
      }
    },
  };
  function assertChosen(args) {
    if (args.instanceId !== "river" || args.modId !== "fabric-api" || args.keepFileName !== "fabric-api-new.jar") {
      throw new Error("Wrong duplicate choice");
    }
  }
}

async function checkMaintenance(theme, viewport) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
  await page.addInitScript(mockNative, { theme });
  const button = (name, scope = page) => scope.getByRole("button", { name, exact: true });
  const nav = page.getByRole("navigation", { name: "Main navigation" });
  const expectNoBanner = async message => {
    assert.equal(await page.locator(".launch-toast").filter({ hasText: message }).count(), 0);
  };
  const expectInlineIssue = async (scope, title, detail) => {
    const issue = scope.locator(".instance-content-issue").filter({ hasText: title });
    const alert = issue.getByRole("alert");
    await alert.waitFor();
    assert.equal(await alert.textContent(), title);
    const details = issue.locator("details");
    assert.ok((await details.textContent()).includes(detail));
    assert.equal(await details.getAttribute("open"), null);
    await expectNoBanner(title);
    await expectNoBanner(detail);
  };
  const expectFlat = async control => {
    const paint = await control.evaluate(element => {
      const style = getComputedStyle(element);
      return { name: element.getAttribute("aria-label") || element.textContent.trim(), image: style.backgroundImage, shadow: style.boxShadow };
    });
    assert.equal(paint.image, "none", `${paint.name} keeps a flat neutral face`);
    assert.doesNotMatch(paint.shadow, /inset/, `${paint.name} leaves ceramic depth to colored actions`);
  };
  const openSettings = async () => {
    await button("Sign in").click();
    await page.getByRole("menuitem", { name: "Client settings", exact: true }).click();
    await button("Updates", page.getByRole("navigation", { name: "Settings sections" })).click();
    await expectFlat(button("Check for updates"));
    await expectFlat(button("Check for mod updates"));
  };
  const openInstance = async name => {
    await button("Instances", nav).click();
    await button(name, page.locator(".desktop-instance-link")).click();
  };
  const waitForCheckCount = count => page.waitForFunction(expected =>
    window.modMaintenanceTest.calls.filter(call => call.command === "check_mod_maintenance").length >= expected, count);
  const checkedIds = () => page.evaluate(() => window.modMaintenanceTest.calls
    .filter(call => call.command === "check_mod_maintenance").map(call => call.args.instanceId));
  const writes = () => page.evaluate(() => window.modMaintenanceTest.calls
    .filter(call => call.command === "update_instance_mods").map(call => call.args));
  const meadowReads = () => page.evaluate(() => window.modMaintenanceTest.calls
    .filter(call => call.command === "list_instance_content" && call.args.instanceId === "meadow" && call.args.category === "mods")
    .length);
  const row = name => page.locator(".installed-content-item").filter({ hasText: name });
  const toolbar = page.locator(".content-toolbar");
  const versionReview = page.getByRole("region", { name: "Change Minecraft version" });
  const menu = name => page.getByRole("dialog", { name: "Actions for " + name });
  const showMenu = async name => { await button("Actions for " + name).click(); };
  const updateAll = async name => {
    await showMenu(name);
    await button("Update all", menu(name)).click();
    await menu(name).waitFor({ state: "hidden" });
    assert.equal(await versionReview.count(), 0);
    assert.equal(await page.getByRole("button", { name: "Minecraft version", exact: true }).count(), 0);
  };
  const expectUpdating = async name => {
    await showMenu(name);
    const updating = button("Updating\u2026", menu(name));
    await updating.waitFor();
    assert.equal(await updating.isDisabled(), true);
    await page.keyboard.press("Escape");
    await menu(name).waitFor({ state: "hidden" });
  };

  try {
    await page.goto(url);
    await waitForCheckCount(2);
    assert.deepEqual((await checkedIds()).sort(), ["meadow", "river"]);
    assert.deepEqual(await writes(), [], "Startup is discovery only");

    await openInstance("Meadow");
    await row("FerriteCore").waitFor();
    assert.equal(await page.evaluate(() => window.modMaintenanceTest.inventoryRead), false,
      "A cold tab renders disk-cached rows before the slower fresh scan returns");
    await page.evaluate(() => window.modMaintenanceTest.releaseInventory());
    await page.waitForFunction(() => window.modMaintenanceTest.inventoryRead);
    await page.getByRole("tab", { name: "Resource packs", exact: true }).click();
    await page.getByRole("tab", { name: "Mods", exact: true }).click();
    await row("FerriteCore").waitFor();
    assert.equal(await meadowReads(), 1, "Returning to a fresh Mods cache does not scan the instance again");
    const skipped = row("FerriteCore").getByText(/Update skipped.*Iris still requires/);
    await skipped.waitFor();
    assert.equal(await skipped.evaluate(element => element.classList.contains("pack-file-source")), true);
    assert.equal(await button("Mod issues", toolbar).count(), 0, "Advisories alone do not show the orange triangle");
    assert.equal(await button("Update all", toolbar).count(), 0);
    assert.deepEqual((await checkedIds()).sort(), ["meadow", "river"], "Navigating to Mods does not repeat the sweep");
    await expectFlat(button("Actions for Meadow"));
    await expectFlat(button("Actions for FerriteCore"));

    const enable = button("Enable Local HUD", row("Local HUD"));
    await enable.click();
    const enableError = "Local HUD requires a dependency Delight could not identify.";
    assert.equal(await row("Local HUD").getByRole("alert").textContent(), enableError);
    await expectNoBanner(enableError);
    assert.equal(await enable.getAttribute("aria-pressed"), "false");
    assert.equal(await page.getByRole("dialog").count(), 0);

    await toolbar.getByRole("searchbox").or(toolbar.getByRole("textbox")).fill("unmatched filter");
    await updateAll("Meadow");
    await page.waitForFunction(() => window.modMaintenanceTest.releaseApply !== null);
    await expectUpdating("Meadow");
    assert.deepEqual(await writes(), [{ instanceId: "meadow" }]);
    assert.equal(await page.getByRole("dialog").count(), 0);
    if (theme === "light") await page.evaluate(() => { window.modMaintenanceTest.failInventoryRefresh = true; });
    await page.evaluate(() => window.modMaintenanceTest.releaseApply());
    await waitForCheckCount(3);
    await page.waitForFunction(() => window.modMaintenanceTest.releaseUpdateCheck !== null);
    await expectUpdating("Meadow");
    await page.evaluate(() => window.modMaintenanceTest.releaseUpdateCheck());
    await versionReview.waitFor({ state: "hidden" });
    await toolbar.getByRole("searchbox").or(toolbar.getByRole("textbox")).fill("");
    if (theme === "light") {
      await expectInlineIssue(page.locator(".instance-workspace"), "Couldn’t refresh installed mods.", "Could not refresh the Mods list.");
      await row("FerriteCore").getByText("7.0.2", { exact: true }).waitFor();
      assert.equal(await meadowReads(), 2, "A failing refresh keeps the previous rows");
      await page.evaluate(() => { window.modMaintenanceTest.failInventoryRefresh = false; });
      await button("Try again").click();
    }
    await row("FerriteCore").getByText("7.0.3", { exact: true }).waitFor();
    await row("New Requirement").waitFor();
    await row("Sodium").getByText("Update skipped. An installed addon needs its current Sodium version.").waitFor();
    assert.equal(await button("Mod issues", toolbar).count(), 0, "Optional skips stay off the orange summary");
    assert.equal(await button("Enable Local HUD", row("Local HUD")).getAttribute("aria-pressed"), "false");
    assert.equal(await meadowReads(), theme === "light" ? 3 : 2);

    await openInstance("River");
    await row("Explorer HUD").waitFor();
    await button("Mod issues", toolbar).hover();
    await page.getByRole("group", { name: "Mod issues" }).getByText("Explorer HUD requires Fabric API.").waitFor();
    await page.evaluate(() => {
      window.modMaintenanceTest.gameRunning = true;
      window.dispatchEvent(new Event("focus"));
    });
    await page.locator(".instance-hero-actions .instance-play").and(page.locator(":disabled")).waitFor();
    await updateAll("River");
    await showMenu("River");
    await button("Update queued", menu("River")).and(page.locator(":disabled")).waitFor();
    await page.keyboard.press("Escape");
    assert.deepEqual(await writes(), [{ instanceId: "meadow" }], "An active game defers all mod writes");
    await openInstance("Meadow");
    await page.evaluate(() => {
      window.modMaintenanceTest.gameRunning = false;
      window.dispatchEvent(new Event("focus"));
    });
    await page.waitForFunction(() => window.modMaintenanceTest.releaseRepair !== null);
    await openInstance("River");
    await expectUpdating("River");
    assert.deepEqual(await writes(), [{ instanceId: "meadow" }, { instanceId: "river" }]);
    await page.evaluate(() => window.modMaintenanceTest.releaseRepair());
    await waitForCheckCount(4);
    await row("Fabric API").getByText("0.116.7", { exact: true }).waitFor();

    await openSettings();
    const toggle = page.getByRole("switch", { name: "Check when Delight opens", exact: true })
      .or(button("Check when Delight opens"));
    const toggleState = async () => await toggle.getAttribute("aria-checked") ?? await toggle.getAttribute("aria-pressed");
    assert.equal(await toggleState(), "true");
    await toggle.click();
    assert.equal(await toggleState(), "false");
    await page.reload();
    await page.evaluate(() => { window.modMaintenanceTest.holdFirstInventory = false; });
    await openSettings();
    assert.equal(await toggleState(), "false", "Startup preference survives a new renderer session");
    assert.deepEqual(await checkedIds(), [], "Disabled startup does not scan the library");
    await page.evaluate(() => {
      window.modMaintenanceTest.failRiverCheck = true;
    });
    await button("Check for mod updates").click();
    await waitForCheckCount(2);
    await page.getByText(/^Check incomplete/).waitFor();
    assert.deepEqual((await checkedIds()).sort(), ["meadow", "river"]);
    assert.deepEqual(await writes(), [], "Manual checks leave apply as a separate action");
    const attentionResult = page.getByRole("button", { name: /^River, .*Needs attention$/ });
    assert.ok(await attentionResult.evaluate(button => {
      const artwork = button.querySelector(".mod-maintenance-instance-art").getBoundingClientRect();
      const name = button.querySelector("strong").getBoundingClientRect();
      const status = button.querySelector(".mod-maintenance-instance-status").getBoundingClientRect();
      const arrow = button.querySelector(":scope > svg").getBoundingClientRect();
      return name.left > artwork.right && status.left >= name.left &&
        arrow.left > status.left && arrow.right <= button.getBoundingClientRect().right;
    }), "Results keep instance artwork and title on the left, with room for status and navigation");
    await attentionResult.click();
    await button("Mod issues", toolbar).hover();
    await page.getByRole("group", { name: "Mod issues" }).getByText("The mod catalog is temporarily unavailable.").waitFor();
    await page.evaluate(() => { window.modMaintenanceTest.failRiverCheck = false; });
    await button("Check again").click();
    await row("Explorer HUD").getByText("Explorer HUD requires Fabric API.", { exact: true }).waitFor();
    assert.equal(await button("Review dependencies").count(), 0);
    assert.deepEqual(await checkedIds(), ["meadow", "river", "river"]);

    await openInstance("River");
    const instanceSettingsTab = page.getByRole("tab", { name: "Instance settings", exact: true });
    await instanceSettingsTab.click();
    const instanceMaintenance = page.getByRole("region", { name: "Mod maintenance", exact: true });
    const checkInstance = button("Check for mod updates and dependencies", instanceMaintenance);
    const checksBeforeScope = (await checkedIds()).length;
    const missingCommand = "Command check_mod_maintenance not found";
    await page.evaluate(message => { window.modMaintenanceTest.scopedCheckError = message; }, missingCommand);
    await checkInstance.click();
    const restartMessage = "Restart Delight Client to check mods.";
    await expectInlineIssue(instanceMaintenance, restartMessage, missingCommand);
    assert.deepEqual((await checkedIds()).slice(checksBeforeScope), ["river"]);

    await page.evaluate(() => {
      window.modMaintenanceTest.scopedCheckError = "";
      window.modMaintenanceTest.repairNeedsEnable = true;
    });
    await checkInstance.click();
    await button("View Mods", instanceMaintenance).click();
    assert.equal(await page.getByRole("tab", { name: "Mods", exact: true }).getAttribute("aria-selected"), "true");
    await page.getByRole("heading", { name: "River", exact: true }).waitFor();
    await row("Explorer HUD").waitFor();
    assert.equal(await button("Review dependencies").count(), 0);
    assert.deepEqual((await checkedIds()).slice(checksBeforeScope), ["river", "river"]);
    assert.deepEqual(await writes(), [], "A single-instance check still leaves apply as a separate action");
    await updateAll("River");
    await page.waitForFunction(() => window.modMaintenanceTest.calls.some(call =>
      call.command === "update_instance_mods" && call.args.instanceId === "river"));
    await waitForCheckCount(checksBeforeScope + 3);
    assert.equal(await button("Disable Fabric API").count(), 0, "The skipped dependency was not enabled");
    await instanceSettingsTab.click();
    await button("Change version").click();
    await versionReview.waitFor();
    const selector = versionReview.getByRole("button", { name: "Minecraft version" });
    await selector.click();
    await page.getByText("1.21.2", { exact: true }).click();
    await versionReview.getByText("Will be removed from this instance", { exact: true }).waitFor();
    await versionReview.getByText("Old Renderer", { exact: true }).waitFor();
    assert.deepEqual(await writes(), [{ instanceId: "river" }], "A target preview does not apply changes");
    await button("Update to 1.21.2", versionReview).click();
    await versionReview.waitFor({ state: "hidden" });
    await page.locator(".instance-identity").getByText(/1\.21\.2/).waitFor();
    assert.deepEqual(errors, []);
  } catch (error) {
    if (errors.length) console.error(`Renderer errors in ${theme}:`, errors);
    throw error;
  } finally {
    await page.close();
  }
}

async function checkDuplicateRouting() {
  const page = await browser.newPage({ viewport: { width: 900, height: 680 }, reducedMotion: "reduce" });
  page.setDefaultTimeout(9000);
  try {
    await page.route("**/*", route => route.request().url().startsWith(url) ? route.continue() : route.abort());
    await page.addInitScript(mockNative, { theme: "light", duplicateFixture: true });
    await page.goto(url);
    await page.getByRole("button", { name: /^Notifications/ }).click();
    await page.getByRole("button", { name: /^Attention needed, River · fabric-api/ }).click();
    const choose = page.getByRole("button", { name: "Choose version for Fabric API", exact: true });
    await choose.waitFor();
    assert.equal(await choose.count(), 1, "A duplicate group is represented by one action even beyond the first page");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Choose version for Fabric API");
    const issues = page.getByRole("button", { name: "Mod issues", exact: true });
    await issues.hover();
    await page.getByText("Review duplicate versions in Mods.", { exact: true }).waitFor();
    await choose.click();
    const review = page.getByRole("region", { name: "Choose version", exact: true });
    await review.getByRole("radio", { name: /fabric-api-new.jar/ }).check();
    await review.getByRole("button", { name: "Keep this version", exact: true }).click();
    await review.waitFor({ state: "hidden" });
    assert.ok(await page.evaluate(() => window.modMaintenanceTest.calls.some(call => call.command === "choose_mod_version")));
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Updates", exact: true }).click();
    await page.getByRole("button", { name: "Keep newest compatible versions", exact: true }).click();
    await page.getByText("Older copies moved to local backups.", { exact: true }).waitFor();
  } finally {
    await page.close();
  }
}

try {
  await checkDuplicateRouting();
  await checkMaintenance("oled", { width: 1440, height: 900 });
  await checkMaintenance("light", { width: 900, height: 680 });
  console.log("Mod maintenance passed in OLED and minimum-size Light. Verified cached rows and refresh, startup opt-out, global and per-instance checks, inline errors, direct updates, waiting for game exit, preserving disabled dependencies, and the separate Minecraft version setting.");
} finally {
  await browser.close();
}
