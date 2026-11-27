// Exercise the existing launcher renderer with an isolated native fixture.
import assert from "node:assert/strict";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const url = process.env.BLOOM_TEST_URL || "http://127.0.0.1:1420";
const releaseUrl = process.env.BLOOM_TEST_RELEASE_URL;

function mockNative({ theme, motion, update, updates, media }) {
  localStorage.setItem("bloom-onboarding-complete-v1", "complete");
  if (!localStorage.getItem("bloom-settings")) {
    localStorage.setItem("bloom-settings", JSON.stringify({
      theme, animations: motion, redesignAppearanceV1: true, closeAfterLaunch: false,
      modChecksOnStartup: false, ...(updates === undefined ? {} : { updates }),
      ...(media === undefined ? {} : { showNowPlaying: media }),
    }));
  }
  localStorage.setItem("bloom-spotlight-instance", "meadow");
  localStorage.setItem("bloom-last-page", "home");

  const instances = [
    { id: "meadow", name: "Meadow" },
    { id: "followed-river", name: "River" },
  ].map(instance => ({
    ...instance, directory: `P:/fixture/${instance.name}`, loader: "Fabric", version: "1.21.1", loaderVersion: "0.16.10",
    java: "Automatic", memory: 4096, jvmArguments: "", visible: true, mods: true, config: true,
    resourcePacks: true, shaderPacks: true,
  }));
  const contents = {
    meadow: [{ id: "meadow-mod.jar", name: "Meadow HUD", fileName: "meadow-mod.jar", version: "1", size: 2048, enabled: true }],
    "followed-river": [{ id: "river-mod.jar", name: "River HUD", fileName: "river-mod.jar", version: "1", size: 2048, enabled: true }],
  };
  const idle = { state: "idle", progress: 0, message: "" };
  const calls = [];
  const callbacks = new Map();
  const listeners = new Map();
  let next = 1;
  const updateNotice = version => ({
    id: "launcher-update", kind: "launcherUpdate", version,
    read: true, available: true, required: false, createdAt: Date.now(),
  });
  let nativeItems = JSON.parse(sessionStorage.getItem("notification-center-fixture") || "[]");
  const currentVersion = sessionStorage.getItem("notification-center-version") || "1.3.2";
  let launchStatus = idle;
  let clientNotice = null;
  let running = false;
  let contentStatus = { sessionId: "notifications-fixture", revision: 0, tasks: [] };
  let publishUpdate;
  let pendingUpdate;
  let pendingInstallation;
  let updateReserved = false;
  let rejectRestart = false;
  let mediaObservation;
  let mediaSession = {
    sessionId: "media-fixture", title: "Test track", artist: "Test artist", source: "Test player",
    isPlaying: true, canPlay: true, canPause: true, canPrevious: false, canNext: true,
    appIcon: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jA6UAAAAASUVORK5CYII=",
  };
  let mixerVolume = { level: 0.37, muted: false, scope: "app" };
  let pcVolume = null;
  const followReview = {
    installedRevision: 1, latestRevision: 2, minimumPlayableRevision: 2, required: true,
    releaseNote: "Shared pack revision", creator: "River", playerUrl: "https://delightstudio.org/share/pack/RIVER123",
    reviewToken: "river-release-review", changes: [],
  };
  const emit = (event, payload) => {
    for (const handler of listeners.values()) {
      if (handler.event === event) callbacks.get(handler.callback)?.({ event, payload });
    }
  };
  const snapshot = () => structuredClone(nativeItems);
  const updateItems = items => {
    nativeItems = structuredClone(items).sort((a, b) => b.createdAt - a.createdAt);
    sessionStorage.setItem("notification-center-fixture", JSON.stringify(nativeItems));
    emit("notifications-changed", snapshot());
    return snapshot();
  };
  const sendMedia = () => {
    if (mediaObservation) emit("desktop-now-playing", { observationId: mediaObservation, session: mediaSession });
  };
  window.notificationTest = {
    calls,
    islandFrame() {
      const geometry = selector => {
        const element = document.querySelector(selector);
        if (!element) return null;
        const { x, y, width, height } = element.getBoundingClientRect();
        return { x, y, width, height, scrollTop: element.scrollTop };
      };
      const cancel = document.querySelector(".desktop-island-cancel-launch");
      return {
        titlebar: geometry(".desktop-titlebar"),
        navigation: geometry(".desktop-rail"),
        firstDestination: geometry(".rail-destinations > button"),
        sidebar: geometry(".desktop-context"),
        workspace: geometry(".app-shell > main"),
        island: {
          ...geometry(".desktop-island-surface"),
          radius: parseFloat(getComputedStyle(document.querySelector(".desktop-island-surface")).borderTopLeftRadius),
        },
        cancelOpacity: cancel ? Number(getComputedStyle(cancel).opacity) : 0,
        noticeIcon: geometry(".desktop-island-notice-icon"),
        noticeMessage: geometry(".desktop-island-notice-message"),
      };
    },
    setItems: updateItems,
    setClientNotice(value) {
      clientNotice = value;
      window.dispatchEvent(new Event("focus"));
    },
    sendLaunch(payload) {
      launchStatus = payload;
      emit("minecraft-launch-progress", payload);
    },
    sendProcess(isRunning) {
      running = isRunning;
      emit("minecraft-process-state", running);
    },
    sendContent(tasks) {
      contentStatus = { ...contentStatus, revision: contentStatus.revision + 1, tasks };
      emit("content-downloads-changed", contentStatus);
    },
    listened(event) { return [...listeners.values()].some(listener => listener.event === event); },
    discoveryPending() { return Boolean(publishUpdate); },
    revealUpdate(outcome) { publishUpdate(outcome); },
    setRunningVersion(version) { sessionStorage.setItem("notification-center-version", version); },
    currentObservation() { return mediaObservation; },
    setMedia(session) { mediaSession = session ? { ...mediaSession, ...session } : null; sendMedia(); },
    setMixerVolume(value) { mixerVolume = value && { ...value, scope: "app" }; },
    setPcVolume(value) { pcVolume = value && { ...value, scope: "system" }; },
    emitMedia(observationId, session) { emit("desktop-now-playing", { observationId, session }); },
    updatePending() { return Boolean(pendingUpdate); },
    updateEvent(event, data) {
      const { callback, index } = pendingUpdate;
      pendingUpdate.index++;
      callbacks.get(callback)?.({ index, message: { event, data } });
    },
    finishUpdate(error) {
      const operation = pendingUpdate;
      pendingUpdate = undefined;
      callbacks.get(operation.callback)?.({ index: operation.index, end: true });
      if (error) operation.reject(new Error(error));
      else operation.resolve(2);
    },
    installationPending() { return Boolean(pendingInstallation); },
    finishInstallation(error) {
      const { resolve, reject } = pendingInstallation;
      pendingInstallation = undefined;
      if (error) reject(new Error(error));
      else resolve();
    },
    rejectNextRestart() { rejectRestart = true; },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
    transformCallback(callback) { const id = next++; callbacks.set(id, callback); return id; },
    unregisterCallback(id) { callbacks.delete(id); },
    convertFileSrc(path) { return path; },
    async invoke(command, args = {}) {
      calls.push({ command, args });
      switch (command) {
        case "get_notifications": return snapshot();
        case "mark_notifications_read": return updateItems(nativeItems.map(item =>
          !args.id || args.id === item.id ? { ...item, read: true } : item));
        case "observe_launcher_notification": {
          const retained = nativeItems.filter(item => item.kind !== "launcherUpdate");
          if (args.availableVersion) retained.push(updateNotice(args.availableVersion));
          else retained.push(...nativeItems.filter(item => item.kind === "launcherUpdate")
            .map(item => ({ ...item, available: item.available && !args.authoritative && item.version !== args.currentVersion })));
          return updateItems(retained);
        }
        case "observe_followed_notification": return snapshot();
        case "list_instances": return instances;
        case "get_cached_instance_content": return null;
        case "list_instance_content": return args.category === "mods" ? contents[args.instanceId] || [] : [];
        case "check_mod_maintenance": return {
          updates: [], repairsAvailable: false, dependencyIssues: [],
          complete: true, issues: [],
        };
        case "get_followed_pack": return args.instanceId === "followed-river"
          ? { playerUrl: followReview.playerUrl, revision: 1, creator: "River" } : null;
        case "check_followed_pack_update": return args.instanceId === "followed-river" ? followReview : null;
        case "get_workspace_release_history": return [{ revision: 2, required: true, releaseNote: "Shared pack revision", creator: "River", createdAt: "2026-11-25T12:00:00Z" }];
        case "get_workspace_publication": return null;
        case "get_workspace_collaboration": return null;
        case "get_client_notice": return { notice: clientNotice, serverTime: Date.now() + 3_600_000 };
        case "get_minecraft_launch_status": return launchStatus;
        case "get_minecraft_process_running": return running;
        case "get_content_downloads": return contentStatus;
        case "launch_minecraft": return;
        case "cancel_titlebar_launch":
          if (launchStatus.launchId === args.launchId) {
            launchStatus = { ...launchStatus, state: "cancelled", progress: 0 };
            emit("minecraft-launch-progress", launchStatus);
          }
          return;
        case "start_now_playing":
          mediaObservation = args.observationId;
          sendMedia();
          return;
        case "stop_now_playing":
          if (mediaObservation === args.observationId) mediaObservation = undefined;
          return;
        case "control_now_playing":
          if (mediaObservation !== args.observationId || mediaSession?.sessionId !== args.sessionId) return false;
          if (args.action === "pause" || args.action === "play") {
            mediaSession = { ...mediaSession, isPlaying: args.action === "play" };
            sendMedia();
          }
          return true;
        case "get_now_playing_volume":
        case "set_now_playing_volume": {
          if (mediaObservation !== args.observationId || mediaSession?.sessionId !== args.sessionId) return null;
          const target = mixerVolume ?? pcVolume;
          if (!target) return null;
          if (command === "set_now_playing_volume" && args.scope === target.scope && args.targetId === target.targetId) {
            target.level = args.level;
          }
          return { ...target };
        }
        case "get_global_file_sync_state": return {
          settings: { optionsSource: null, serversSource: null, voiceChatSource: null, voiceChatTargets: [], shareResourcePacks: false, shareShaderPacks: false },
          statuses: [], backupRoot: "",
        };
        case "list_minecraft_accounts": return { activeId: null, accounts: [] };
        case "list_portal": return { entries: [], warnings: [] };
        case "plugin:window|is_maximized": return false;
        case "plugin:app|version": return currentVersion;
        case "plugin:updater|check":
          if (!update) throw new Error("Only the release test may reach the native updater");
          return new Promise((resolve, reject) => {
            publishUpdate = outcome => {
              publishUpdate = undefined;
              if (outcome === "offline") reject(new Error("Fixture is offline"));
              else resolve(outcome === "none" ? null : { rid: 1, currentVersion, version: "1.4.0", body: "New launcher release notes." });
            };
          });
        case "reserve_launcher_update":
          if (!update || updateReserved) throw new Error("Unexpected update reservation");
          updateReserved = true;
          return 3;
        case "plugin:updater|download":
          if (!updateReserved || pendingUpdate) throw new Error("Unexpected updater download");
          return new Promise((resolve, reject) => {
            pendingUpdate = { resolve, reject, callback: args.onEvent.id, index: 0 };
          });
        case "plugin:updater|install":
          if (!updateReserved || pendingInstallation) throw new Error("Unexpected updater installation");
          return new Promise((resolve, reject) => { pendingInstallation = { resolve, reject }; });
        case "plugin:resources|close":
          if (args.rid === 3) updateReserved = false;
          return;
        case "plugin:process|restart":
          if (!updateReserved) throw new Error("Unexpected native restart");
          if (rejectRestart) {
            rejectRestart = false;
            throw new Error("Fixture restart interrupted");
          }
          return;
        case "take_workspace_player_links":
        case "list_instance_folders":
        case "list_pack_channel_memberships":
        case "list_cached_screenshots":
        case "list_managed_java_runtimes":
        case "reconcile_cosmetics": return [];
        case "plugin:event|listen": {
          const id = next++;
          listeners.set(id, { event: args.event, callback: args.handler });
          return id;
        }
        case "plugin:event|unlisten": listeners.delete(args.eventId); return;
        default: return null;
      }
    },
  };
}

const notices = [
  { id: "maintenance-done", kind: "modUpdateCompleted", instanceId: "meadow", instanceName: "Meadow", version: null },
  { id: "maintenance-failed", kind: "modUpdateFailed", instanceId: "followed-river", instanceName: "River", version: null },
  { id: "release-river", kind: "followedRelease", instanceId: "followed-river", instanceName: "River", version: "2", required: true },
  { id: "launcher-update", kind: "launcherUpdate", instanceId: null, instanceName: null, version: "1.4.0" },
].map((notice, index) => ({
  required: false, read: false, available: true, ...notice, createdAt: Date.now() - index * 1000,
}));

async function openFixture(theme, viewport, motion, { target = url, update = false, updates, media } = {}) {
  const page = await browser.newPage({ viewport, reducedMotion: motion ? "no-preference" : "reduce" });
  page.setDefaultTimeout(9000);
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route => new URL(route.request().url()).origin === new URL(target).origin ? route.continue() : route.abort());
  await page.addInitScript(mockNative, { theme, motion, update, updates, media });
  await page.goto(target, { waitUntil: "domcontentloaded" });
  await page.getByRole("navigation", { name: "Main navigation" }).waitFor();
  await page.waitForFunction(() =>
    window.notificationTest.listened("notifications-changed") && window.notificationTest.listened("minecraft-launch-progress"));
  return { page, errors };
}

function surfaces(page) {
  const titlebar = page.locator(".desktop-titlebar");
  return {
    titlebar,
    island: titlebar.locator(".desktop-notification-center"),
    bell: titlebar.getByRole("button", { name: /^Notifications\b/i }),
    panel: page.getByRole("region", { name: "Notifications", exact: true }),
    progress: titlebar.getByRole("progressbar", { name: "Launching Minecraft", exact: true }),
    windowControls: titlebar.getByRole("group", { name: "Window controls" }),
  };
}

async function assertCentered(locator, viewportWidth, message) {
  const { x, width } = await locator.boundingBox();
  assert.ok(Math.abs(x + width / 2 - viewportWidth / 2) <= 1, message);
}

const workspaceTop = page => page.locator(".app-shell > main").evaluate(element => element.getBoundingClientRect().top);
const islandFrame = page => page.evaluate(() => window.notificationTest.islandFrame());

function assertFixedWorkspace(frame, baseline) {
  for (const surface of ["titlebar", "navigation", "firstDestination", "sidebar", "workspace"]) {
    assert.deepEqual(frame[surface], baseline[surface], `Expanding the island keeps the ${surface} stationary`);
  }
}

async function captureIslandTransition(page, island, action) {
  await page.evaluate(() => {
    const { islandFrame } = window.notificationTest;
    const frames = [islandFrame()];
    let frameId;
    const sample = () => {
      frames.push(islandFrame());
      frameId = requestAnimationFrame(sample);
    };
    frameId = requestAnimationFrame(sample);
    window.notificationTest.finishAnimationCapture = () => {
      cancelAnimationFrame(frameId);
      return [...frames, islandFrame()];
    };
  });
  await action();
  await island.evaluate(async element => {
    await new Promise(resolve => requestAnimationFrame(resolve));
    const finiteAnimations = element.getAnimations({ subtree: true }).filter(animation =>
      animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.allSettled(finiteAnimations.map(animation => animation.finished));
  });
  return page.evaluate(() => window.notificationTest.finishAnimationCapture());
}

function assertIslandTransition(frames, viewportWidth, motion, opening, kind) {
  const start = frames[0];
  const end = frames.at(-1);
  for (const frame of frames) {
    assertFixedWorkspace(frame, start);
    assert.ok(Math.abs(frame.island.x + frame.island.width / 2 - viewportWidth / 2) <= 1,
      "The island stays centered in every animation frame");
    assert.ok(Math.abs(frame.island.y - start.island.y) <= 1, "The top of the island stays attached to the title bar");
  }
  const [idle, expanded] = opening ? [start.island, end.island] : [end.island, start.island];
  const addedWidth = expanded.width - idle.width;
  const addedHeight = expanded.height - idle.height;
  if (kind === "notifications") {
    assert.ok(idle.width >= 50 && idle.width <= 56, "The idle bell fits a compact pill");
    assert.ok(expanded.width >= 400 && expanded.width <= 420, "Notifications open to a roomy desktop width");
    assert.ok(addedHeight > 0, "Notifications extend below the title bar");
  } else {
    assert.ok(addedWidth >= -1 && addedWidth <= 34, "The notice widens slightly when the title bar has room");
    assert.ok(addedHeight > 0, "The full notice grows below the title bar");
  }
  assert.ok(Math.abs(idle.radius - idle.height / 2) <= 0.5, "The compact surface uses a full pill radius");
  assert.ok(Math.abs(expanded.radius - idle.radius / 2) <= 0.5, "The expanded corner radius is half the compact pill radius");
  const intermediateRadius = frames.some(({ island }) => island.radius > expanded.radius + 0.25 && island.radius < idle.radius - 0.25);
  assert.equal(intermediateRadius, motion, "The corner radius follows the motion preference during the morph");
  if (motion) {
    for (const axis of ["width", "height"]) {
      if (kind === "notice" && axis === "width" && addedWidth <= 4) continue;
      assert.ok(frames.some(({ island }) => island[axis] > idle[axis] + 2 && island[axis] < expanded[axis] - 2),
        `The island ${opening ? "opens" : "closes"} through intermediate ${axis} values`);
    }
  } else {
    assert.ok(!frames.some(({ island }) =>
      island.width > idle.width + 2 && island.width < expanded.width - 2 ||
      island.height > idle.height + 2 && island.height < expanded.height - 2),
    "Reduced motion switches directly between the compact and expanded states");
  }
}

function assertLaunchCancelTransition(frames, viewportWidth, motion, opening) {
  const start = frames[0];
  const end = frames.at(-1);
  for (const frame of frames) {
    assertFixedWorkspace(frame, start);
    assert.ok(Math.abs(frame.island.x + frame.island.width / 2 - viewportWidth / 2) <= 1,
      "Launch cancellation widens from the center");
    for (const property of ["y", "height", "radius"]) {
      assert.equal(frame.island[property], start.island[property], `Launch cancellation preserves the pill's ${property}`);
    }
    assert.ok(frame.island.y + frame.island.height <= frame.titlebar.y + frame.titlebar.height,
      "The launch pill stays inside the title bar throughout the reveal");
  }
  const [compact, widened] = opening ? [start, end] : [end, start];
  assert.ok(widened.island.width > compact.island.width + 12, "The pill makes room for the Cancel X");
  const intermediateWidth = frames.some(({ island }) =>
    island.width > compact.island.width + 2 && island.width < widened.island.width - 2);
  assert.equal(intermediateWidth, motion, "Launch cancellation honors the motion preference when widening");
  if (opening) {
    assert.equal(compact.cancelOpacity, 0, "The Cancel X starts hidden");
    assert.equal(widened.cancelOpacity, 1, "The Cancel X reaches full opacity");
    assert.equal(frames.some(({ cancelOpacity }) => cancelOpacity > 0.02 && cancelOpacity < 0.98), motion,
      "The Cancel X fades in when motion is enabled");
  }
}

async function assertOverWorkspace(panel, baseline, viewportWidth) {
  await assertCentered(panel, viewportWidth, "The detail content is centered underneath the compact face");
  assert.ok(await panel.evaluate(element => {
    const surface = element.closest(".desktop-island-surface");
    if (!surface) return false;
    return [getComputedStyle(surface), getComputedStyle(surface, "::before"), getComputedStyle(surface, "::after")].every(style =>
      style.outlineStyle === "none" && !style.boxShadow.includes("inset") &&
      [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth].every(width => parseFloat(width) === 0));
  }), "The expanded island stays borderless while the trigger is hovered");
  assert.ok(await panel.evaluate(element => {
    const panel = element.getBoundingClientRect();
    const workspace = document.querySelector(".app-shell > main");
    const bounds = workspace.getBoundingClientRect();
    const overlapTop = Math.max(bounds.top, panel.top);
    const overlapBottom = Math.min(bounds.bottom, panel.bottom);
    if (overlapBottom <= overlapTop) return false;
    const y = (overlapBottom + overlapTop) / 2;
    const inside = document.elementFromPoint(panel.x + panel.width / 2, y);
    const outside = document.elementFromPoint((panel.right + bounds.right) / 2, y);
    return element.contains(inside) && workspace.contains(outside);
  }), "Details sit above the workspace and leave the rest of the page interactive");
  assertFixedWorkspace(await islandFrame(panel.page()), baseline);
}

async function assertNotificationWidth(panel) {
  const { width, available } = await panel.evaluate(element => ({
    width: element.getBoundingClientRect().width,
    available: parseFloat(getComputedStyle(element).getPropertyValue("--desktop-island-fit")),
  }));
  assert.ok(Math.abs(width - (Math.min(420, available) - 16)) <= 1, "Notifications fill the available panel with slim gutters");
}

async function openApplicationMenuItem(titlebar, menu, item) {
  await titlebar.getByRole("menuitem", { name: menu, exact: true }).click();
  await titlebar.getByRole("menuitem", { name: item, exact: true }).click();
}

function updaterSurfaces(page) {
  const titlebar = page.locator(".desktop-titlebar");
  const confirmation = titlebar.getByRole("group", { name: "Confirm launcher update", exact: true });
  return {
    trigger: titlebar.getByRole("button", { name: "Update available", exact: true }),
    confirmation,
    action: confirmation.getByRole("button", { name: "Update and restart", exact: true }),
    dismiss: confirmation.getByRole("button", { name: "Dismiss update confirmation", exact: true }),
    updateProgress: titlebar.getByRole("progressbar", { name: "Updating Delight Client", exact: true }),
  };
}

function assertUpdateInTitlebar(frame, baseline, viewportWidth) {
  assertFixedWorkspace(frame, baseline);
  assert.ok(Math.abs(frame.island.x + frame.island.width / 2 - viewportWidth / 2) <= 1,
    "Update activity stays centered in the window");
  for (const property of ["y", "height", "radius"]) {
    assert.ok(Math.abs(frame.island[property] - baseline.island[property]) <= 0.5,
      `Inline updater preserves the pill's ${property}`);
  }
  assert.ok(frame.island.y + frame.island.height <= frame.titlebar.y + frame.titlebar.height,
    "The update UI stays inside the title bar");
}

async function assertUpdateTriggerSpacing(trigger) {
  const spacing = await trigger.evaluate(async button => {
    const island = button.closest(".desktop-notification-center");
    await new Promise(resolve => requestAnimationFrame(resolve));
    const animations = island.getAnimations({ subtree: true }).filter(animation =>
      animation.effect?.getComputedTiming().endTime !== Infinity);
    await Promise.allSettled(animations.map(animation => animation.finished));
    const surface = island.querySelector(".desktop-island-surface").getBoundingClientRect();
    const label = button.querySelector(".desktop-launcher-update-label");
    const labelBounds = label.getBoundingClientRect();
    const arrowBounds = button.querySelector(".desktop-launcher-update-icon").getBoundingClientRect();
    return {
      left: labelBounds.left - surface.left,
      right: surface.right - arrowBounds.right,
      gap: arrowBounds.left - labelBounds.right,
      clipped: label.scrollWidth > label.clientWidth + 1,
    };
  });
  assert.ok(!spacing.clipped && spacing.gap > 0 && spacing.gap <= 12,
    `The complete label sits left of a nearby arrow: ${JSON.stringify(spacing)}`);
  assert.ok(Math.abs(spacing.left - spacing.right) <= 2,
    `The label and arrow are centered together: ${JSON.stringify(spacing)}`);
  assert.ok(Math.min(spacing.left, spacing.right) >= 6 && Math.max(spacing.left, spacing.right) <= 18,
    `The compact pill hugs the centered label and arrow: ${JSON.stringify(spacing)}`);
}

async function openUpdateSettings(page) {
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.getByRole("menuitem", { name: "Client settings", exact: true }).click();
  await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Updates", exact: true }).click();
}

async function assertNoUpdateWrites(page) {
  assert.equal(await page.evaluate(() => window.notificationTest.calls.some(({ command }) =>
    /^reserve_launcher_update$|^plugin:updater\|(download|download_and_install|install)$|^plugin:process\|restart$/.test(command))), false);
}

async function runPreviewCommand(page, command, available = true) {
  const commandPalette = page.getByRole("dialog", { name: "Quick switcher", exact: true });
  const search = commandPalette.getByRole("combobox");
  await page.keyboard.press("Control+k");
  await search.fill(command);
  if (available) {
    await commandPalette.getByRole("option").waitFor();
    await search.press("Enter");
  } else {
    await commandPalette.getByText("No matches", { exact: true }).waitFor();
    await search.press("Enter");
    assert.equal(await commandPalette.isVisible(), true);
    await search.press("Escape");
  }
  await commandPalette.waitFor({ state: "hidden" });
}

async function checkDevPreviewCommands(target, available) {
  const { page, errors } = await openFixture("oled", { width: 1440, height: 900 }, true, { target, updates: false });
  const { bell } = surfaces(page);
  const { trigger, confirmation, action, updateProgress } = updaterSurfaces(page);
  const unlock = page.locator('.desktop-notification-center[data-face="cosmetic"]');
  await page.route("**/artwork/capes/christmas-delight-cape-v2.png", route => route.fulfill({
    contentType: "image/svg+xml",
    body: '<svg width="10" height="16" xmlns="http://www.w3.org/2000/svg"><rect width="10" height="16" fill="#69172c"/></svg>',
  }));

  try {
    await bell.waitFor();
    await runPreviewCommand(page, "/mock update", available);
    if (available) {
      await trigger.waitFor();
      assert.equal(await confirmation.count(), 0, "The slash command starts with the compact update face");
      await assertUpdateTriggerSpacing(trigger);
      await trigger.click();
      await confirmation.waitFor();
      await action.click();
      await updateProgress.waitFor();
      await bell.waitFor();
    } else {
      assert.equal(await trigger.count(), 0);
    }

    await runPreviewCommand(page, "/mock redeem", available);
    if (available) {
      await unlock.getByText("Cosmetic unlocked", { exact: true }).waitFor();
      const confetti = page.locator(".desktop-island-confetti");
      await confetti.waitFor({ state: "attached" });
      await page.waitForFunction(() => {
        const canvas = document.querySelector('[data-face="cosmetic"] .cape-display canvas');
        return canvas?.getContext("2d").getImageData(5, 5, 1, 1).data[3] > 0;
      });
      await unlock.getByRole("button", { name: "Equip Christmas Delight cape", exact: true }).click();
      const cloaks = page.getByRole("navigation", { name: "Locker categories" })
        .getByRole("button", { name: "Cloaks", exact: true });
      await cloaks.waitFor();
      assert.equal(await cloaks.getAttribute("aria-current"), "page");
      assert.equal(await page.getByRole("button", { name: "Wear Christmas Delight cape", exact: true }).count(), 0,
        "Preview Equip leaves the real collection unchanged");
      await unlock.waitFor({ state: "hidden" });
    } else {
      assert.equal(await unlock.count(), 0);
    }

    await assertNoUpdateWrites(page);
    assert.deepEqual(await page.evaluate(() => window.notificationTest.calls.filter(({ command, args }) =>
      command === "plugin:updater|check" || (command === "observe_launcher_notification" && args.availableVersion) ||
      (command === "cosmetics_request" && args.method !== "GET"))), [],
    "The preview commands leave updater notifications and cosmetics ownership alone");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkDevPreviewWithoutArtwork() {
  const { page, errors } = await openFixture("oled", { width: 1440, height: 900 }, false, { updates: false });
  try {
    await page.route("**/artwork/capes/christmas-delight-cape-v2.png", route => route.fulfill({ status: 404 }));
    await runPreviewCommand(page, "/mock redeem");
    const unlock = page.locator('.desktop-notification-center[data-face="cosmetic"]');
    await unlock.locator(".desktop-island-cosmetic-art > svg").waitFor({ state: "attached" });
    await unlock.getByRole("button", { name: "Equip Christmas Delight cape", exact: true }).click();
    await unlock.waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function assertIslandClip(locator) {
  const result = await locator.evaluate(element => {
    const surface = element.closest(".desktop-island-surface");
    surface.scrollTo(180, 60);
    const outer = surface.getBoundingClientRect();
    const item = element.getBoundingClientRect();
    const inside = item.left >= outer.left - 1 && item.right <= outer.right + 1 &&
      item.top >= outer.top - 1 && item.bottom <= outer.bottom + 1;
    const result = { x: surface.scrollLeft, y: surface.scrollTop, inside };
    surface.scrollTo(0, 0);
    return result;
  });
  assert.deepEqual(result, { x: 0, y: 0, inside: true }, "The island clips its contents without scrolling the active controls out of view");
}

async function checkPanel() {
  const viewport = { width: 1440, height: 900 };
  const { page, errors } = await openFixture("oled", viewport, true);
  const { titlebar, island, bell, panel } = surfaces(page);
  try {
    await assertCentered(island, viewport.width, "The idle bell is centered against the full window");
    assert.ok(await bell.evaluate(element => {
      const glyph = element.querySelector("svg").getBoundingClientRect();
      const surface = element.closest(".desktop-island-surface").getBoundingClientRect();
      return surface.width - glyph.width > surface.height - glyph.height;
    }), "The compact bell has more breathing room at the sides than above and below");
    const baseline = await islandFrame(page);
    assert.equal(await bell.getAttribute("aria-expanded"), "false");
    await bell.hover();
    assert.equal(await panel.count(), 0, "Hovering the notification pill keeps details collapsed");
    await bell.focus();
    const opening = await captureIslandTransition(page, island, async () => {
      await page.keyboard.press("Enter");
      await panel.getByText(/^No notifications yet\.?$/).waitFor();
    });
    assertIslandTransition(opening, viewport.width, true, true, "notifications");
    assert.equal(await page.getByRole("dialog", { name: "Notifications" }).count(), 0);
    await page.getByRole("region", { name: "Notifications", exact: true }).waitFor();
    assert.equal(await panel.getByText("Notifications", { exact: true }).count(), 0, "The history omits the visible heading");
    assert.equal(await bell.getAttribute("aria-expanded"), "true");
    await bell.hover();
    assert.equal(await bell.getAttribute("title"), null, "The native tooltip stays hidden while the panel is open");
    await assertOverWorkspace(panel, baseline, viewport.width);
    const closing = await captureIslandTransition(page, island, async () => {
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
    });
    assertIslandTransition(closing, viewport.width, true, false, "notifications");
    assert.ok(await bell.evaluate(element => document.activeElement === element));
    await assertIslandClip(bell.locator("svg"));
    assert.equal(await bell.getAttribute("title"), "Notifications", "The compact bell restores its tooltip");

    await page.evaluate(items => window.notificationTest.setItems(items), [
      ...notices.slice(0, 2),
      { ...notices[2], instanceName: "A shared instance name that needs more room to wrap ".repeat(4).trim() },
      { ...notices[3], available: false },
    ]);
    await titlebar.getByRole("button", { name: "Notifications, unread", exact: true }).waitFor();
    assert.match(await bell.getAttribute("aria-label"), /unread/i);
    await bell.click();
    const clear = island.getByRole("button", { name: "Mark all as read", exact: true });
    await clear.waitFor();
    assert.ok(await clear.evaluate(button => {
      const compact = button.closest(".desktop-island-compact").getBoundingClientRect();
      const action = button.getBoundingClientRect();
      return action.top >= compact.top && action.bottom <= compact.bottom;
    }), "Mark all as read shares the compact row");
    assert.equal(await panel.getByRole("button", { name: "Mark all as read" }).count(), 0);
    assert.ok(await panel.locator(".desktop-notification-row-dot").count() > 0);
    assert.ok(await panel.locator(".desktop-notification-row").evaluateAll(rows => rows.every(row => {
      const icon = row.querySelector(".desktop-notification-icon").getBoundingClientRect();
      const title = row.querySelector(".desktop-notification-title").getBoundingClientRect();
      const detail = row.querySelector(".desktop-notification-detail")?.getBoundingClientRect();
      return Math.abs(title.left - icon.right - 8) <= 1 && (!detail || Math.abs(detail.left - title.left) <= 1);
    })), "All notification titles and details start just after the icon");
    const longEntry = panel.getByText(/Required before play/);
    await longEntry.waitFor();
    await assertNotificationWidth(panel);
    assert.ok(await longEntry.evaluate(element => element.offsetHeight > 25 && element.scrollWidth <= element.clientWidth + 1),
      "A long notice wraps instead of overflowing");
    const markCalls = () => page.evaluate(() => window.notificationTest.calls.filter(call => call.command === "mark_notifications_read"));
    assert.deepEqual(await markCalls(), [], "Opening the panel leaves entries unread");
    const row = expression => panel.getByRole("button", { name: expression }).or(panel.getByRole("link", { name: expression }));
    const completion = row(/mods updated|mod updates? (?:completed|finished)/i);
    await completion.click();
    await page.getByRole("heading", { name: "Downloads", exact: true }).waitFor();
    await panel.waitFor({ state: "hidden" });
    assert.deepEqual((await markCalls()).map(call => call.args.id), ["maintenance-done"]);

    await bell.click();
    await row(/mod (?:update|changes?).*(?:failed|couldn.t)|couldn.t update mods/i).click();
    await page.getByText("River HUD", { exact: true }).waitFor();
    assert.deepEqual((await markCalls()).map(call => call.args.id), ["maintenance-done", "maintenance-failed"]);

    await bell.click();
    await row(/pack (?:update|release)|new release/i).click();
    await page.getByRole("region", { name: "Followed pack releases", exact: true }).waitFor();
    assert.deepEqual((await markCalls()).map(call => call.args.id), ["maintenance-done", "maintenance-failed", "release-river"]);
    await page.waitForFunction(() => window.notificationTest.calls.some(({ command, args }) =>
      command === "observe_followed_notification" && args.instanceId === "followed-river" &&
      args.installedRevision === 1 && args.latestRevision === 2 && args.required));
    assert.equal(await page.evaluate(() => window.notificationTest.calls.some(call =>
      ["update_instance_mods", "update_followed_pack", "launch_minecraft"].includes(call.command))), false, "Rows navigate without applying updates");

    await bell.click();
    await clear.click();
    await clear.waitFor({ state: "hidden" });
    assert.doesNotMatch(await bell.getAttribute("aria-label"), /unread/i);
    await completion.waitFor();
    await titlebar.getByRole("button", { name: "Delight home", exact: true }).click();
    await panel.waitFor({ state: "hidden" });
    await page.reload({ waitUntil: "domcontentloaded" });
    await bell.waitFor();
    await bell.click();
    await completion.waitFor();
    assert.doesNotMatch(await bell.getAttribute("aria-label"), /unread/i);
    await openApplicationMenuItem(titlebar, "Help", "Check for updates");
    const { trigger, confirmation, action, updateProgress } = updaterSurfaces(page);
    await confirmation.waitFor();
    assert.ok(await action.isEnabled());
    assert.equal(await page.getByRole("dialog", { name: "Update available", exact: true }).count(), 0);
    assert.equal(await page.locator(".rail-update-trigger").count(), 0);
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "hidden" });
    await trigger.waitFor();
    assert.ok(await trigger.evaluate(element => document.activeElement === element));
    await assertNoUpdateWrites(page);
    await trigger.click();
    await action.click();
    await updateProgress.waitFor();
    await bell.waitFor({ timeout: 10000 });
    await assertNoUpdateWrites(page);
    assert.equal(await page.evaluate(() =>
      window.notificationTest.calls.some(call => call.command === "plugin:updater|check")), false,
    "The development preview never reaches the production updater");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkProgress(theme, viewport, motion, target = url) {
  const { page, errors } = await openFixture(theme, viewport, motion, { target });
  const { titlebar, island, bell, panel, progress, windowControls } = surfaces(page);
  const launch = titlebar.locator(".desktop-notification-launch");
  const cancel = titlebar.getByRole("button", { name: "Cancel launch", exact: true });
  const play = page.locator(".spotlight-play");
  const send = (state, percent, launchId) => page.evaluate(({ state, percent, launchId }) => {
    window.notificationTest.sendLaunch({ state, progress: percent, instanceId: "meadow", ...(launchId ? { launchId } : {}), message: state });
  }, { state, percent, launchId });
  const waitForPercent = async percent => {
    await progress.waitFor();
    await page.waitForFunction(value => document.querySelector(".desktop-titlebar [role=progressbar]")?.getAttribute("aria-valuenow") === String(value), percent);
    const label = titlebar.getByText(`${percent}%`, { exact: true });
    await label.waitFor();
    return label;
  };
  const rightEdge = locator => locator.evaluate(element => element.getBoundingClientRect().right);
  try {
    await bell.waitFor();
    const controlsLeft = (await windowControls.boundingBox()).x;
    const top = await workspaceTop(page);
    await bell.click();
    await panel.waitFor();
    const rect = await panel.boundingBox();
    assert.ok(rect.x >= 0 && rect.x + rect.width <= viewport.width, "The panel fits the available window width");
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    assert.equal(await workspaceTop(page), top);
    await send("installing", 42);
    await page.waitForFunction(() => document.querySelector(".app-shell .desktop-progress"));
    assert.equal(await progress.count(), 0, "A native import or repair uses its regular download progress");
    assert.ok(await bell.isVisible());
    await send("idle", 0);
    await play.click();
    await page.waitForFunction(() => window.notificationTest.calls.some(call => call.command === "launch_minecraft" && call.args.instanceId === "meadow"));
    await send("launching", 8, "fixture-launch-1");
    await waitForPercent(8);
    assert.equal(await bell.count(), 0, "The bell gives way to the launch bar");
    await cancel.waitFor({ state: "hidden" });
    assert.match(await launch.innerText(), /^8%$/, "The compact face only shows the progress track and percentage");
    await send("installing", 42, "fixture-launch-1");
    const label = await waitForPercent(42);
    const track = titlebar.locator(".desktop-notification-launch-track");
    const fill = track.locator(":scope > span");
    await page.waitForFunction(() => document.querySelector(".desktop-notification-launch-track")?.getBoundingClientRect().width >= 110);
    await island.evaluate(element => Promise.allSettled(element.getAnimations().map(animation => animation.finished)));
    assert.equal(await fill.evaluate(element => element.style.getPropertyValue("--launch-fill")), "0.42");
    await assertCentered(island, viewport.width, "Both edges grow out from the window center during launch");
    assert.equal(await workspaceTop(page), top, "Automatic launch progress causes no workspace movement");
    const percentRight = await rightEdge(label);
    assert.equal((await windowControls.boundingBox()).x, controlsLeft, "Window controls remain anchored");
    await page.evaluate(() => window.notificationTest.sendProcess(true));
    await send("launching", 97, "fixture-launch-1");
    assert.ok(Math.abs((await rightEdge(await waitForPercent(97))) - percentRight) <= 1, "The percentage stays right-anchored");
    const launched = titlebar.getByText("Launched", { exact: true });
    assert.equal(await launched.count(), 0, "Spawning Java alone is not readiness");
    await page.evaluate(item => window.notificationTest.setItems([item]), notices[0]);
    await send("running", 100, "fixture-launch-1");
    await launched.waitFor();
    const visibleAt = Date.now();
    await bell.waitFor();
    assert.ok(Date.now() - visibleAt >= 700, "The Launched label stays visible for its completion pause");
    assert.match(await bell.getAttribute("aria-label"), /unread/i, "Unread notifications survive the launch animation");
    await send("running", 100, "fixture-launch-1");
    assert.equal(await launched.count(), 0, "A replay cannot repeat the success animation");
    await page.evaluate(() => window.notificationTest.sendProcess(false));
    await send("idle", 0, "fixture-launch-1");

    await play.click();
    await page.waitForFunction(() => window.notificationTest.calls.filter(call => call.command === "launch_minecraft").length === 2);
    await send("launching", 13, "fixture-launch-2");
    await waitForPercent(13);
    await island.evaluate(element => Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
    const baseline = await islandFrame(page);
    const opening = await captureIslandTransition(page, island, async () => {
      await launch.hover();
      await cancel.waitFor();
    });
    assertLaunchCancelTransition(opening, viewport.width, motion, true);
    assertFixedWorkspace(await islandFrame(page), baseline);
    assert.equal(await titlebar.locator(".desktop-island-launch-trigger, .desktop-island-launch-options").count(), 0,
      "Hovering the bar needs neither a covering trigger nor a detail overlay");
    assert.equal(await progress.evaluate(element => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)",
      "Hovering the progress display leaves it unboxed");
    assert.equal(await cancel.locator("svg").count(), 1, "Cancel appears as an icon button");
    const cancelRect = await cancel.boundingBox();
    const progressRect = await progress.boundingBox();
    assert.ok(cancelRect.x >= progressRect.x + progressRect.width - 1, "Cancel sits to the right of the progress display");
    assert.ok(cancelRect.y >= baseline.island.y && cancelRect.y + cancelRect.height <= baseline.island.y + baseline.island.height + 1,
      "The Cancel X fits inside the pill");
    await page.mouse.move(cancelRect.x + cancelRect.width / 2, cancelRect.y + cancelRect.height / 2, { steps: 8 });
    await page.waitForFunction(() => {
      const button = document.querySelector(".desktop-island-cancel-launch:hover");
      if (!button) return false;
      const context = document.createElement("canvas").getContext("2d");
      context.fillStyle = getComputedStyle(button).color;
      context.fillRect(0, 0, 1, 1);
      const [red, green, blue] = context.getImageData(0, 0, 1, 1).data;
      return red > green + 30 && red > blue + 30;
    });
    assert.ok(await cancel.isVisible(), "Moving from the progress display to the red Cancel X keeps it open");
    const closing = await captureIslandTransition(page, island, async () => {
      await page.mouse.move(5, top + 180);
      await cancel.waitFor({ state: "hidden" });
    });
    assertLaunchCancelTransition(closing, viewport.width, motion, false);
    assert.equal(await page.evaluate(() => window.notificationTest.calls.filter(({ command }) => command === "cancel_titlebar_launch").length), 0,
      "A hover reveal and dismissal do not cancel the launch");

    if (motion) {
      await launch.hover();
      await cancel.click();
    } else {
      await progress.focus();
      await cancel.waitFor();
      await page.keyboard.press("Tab");
      assert.ok(await cancel.evaluate(element => document.activeElement === element), "Cancel launch is reachable by keyboard");
      await page.keyboard.press("Escape");
      await cancel.waitFor({ state: "hidden" });
      assert.ok(await progress.evaluate(element => document.activeElement === element), "Escape returns focus to launch progress");
      await page.keyboard.press("Shift+Tab");
      await progress.focus();
      await cancel.waitFor();
      await page.keyboard.press("Tab");
      await page.keyboard.press("Enter");
    }
    await page.waitForFunction(() => window.notificationTest.calls.some(({ command, args }) =>
      command === "cancel_titlebar_launch" && args.launchId === "fixture-launch-2"));
    await bell.waitFor();
    assert.equal(await progress.count(), 0);
    assert.equal(await launched.count(), 0);

    await play.click();
    await page.waitForFunction(() => window.notificationTest.calls.filter(call => call.command === "launch_minecraft").length === 3);
    await send("launching", 72, "fixture-launch-3");
    await waitForPercent(72);
    await send("error", 0, "fixture-launch-3");
    await bell.waitFor();
    assert.equal(await launched.count(), 0, "A failed launch restores the bell without a success state");

    await page.evaluate(() => window.notificationTest.sendContent([{
      id: "content-task", instanceId: "meadow", instanceName: "Meadow", projectId: "project-hud",
      category: "mods", title: "HUD", version: "1.2", state: "installing", message: "Downloading",
      progress: 40, downloadedBytes: 20, totalBytes: 50, bytesPerSecond: 10, revision: 1,
    }]));
    await page.waitForFunction(() => document.querySelector(".app-shell .desktop-progress"));
    assert.equal(await progress.count(), 0, "Catalog downloads leave the bell in place");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkLauncherUpdate(theme, viewport, motion) {
  const { page, errors } = await openFixture(theme, viewport, motion, { target: releaseUrl, update: true });
  const { titlebar, island, panel, progress, windowControls } = surfaces(page);
  const { trigger, confirmation, action, dismiss, updateProgress } = updaterSurfaces(page);
  const oldUpdateRegion = page.getByRole("region", { name: /^(Update available|Updating Delight Client|Update interrupted|Restart to finish)$/ });
  const updateStatus = text => updateProgress.getByText(text, { exact: true });
  const readPercentGeometry = text => updateStatus(text).evaluate(label => {
    const track = label.parentElement.querySelector(".desktop-notification-launch-track").getBoundingClientRect();
    const range = document.createRange();
    range.selectNodeContents(label);
    const digits = range.getBoundingClientRect();
    return { right: digits.right, gap: digits.left - track.right, trackWidth: track.width };
  });
  const confirmRetry = async (compactLabel, actionLabel) => {
    const retryTrigger = titlebar.getByRole("button", { name: compactLabel, exact: true });
    const retryAction = confirmation.getByRole("button", { name: actionLabel, exact: true });
    await retryTrigger.or(retryAction).waitFor();
    if (await retryTrigger.isVisible()) await retryTrigger.click();
    await retryAction.click();
  };
  const calls = () => page.evaluate(() => window.notificationTest.calls.map(call => call.command));
  const downloads = async () => (await calls()).filter(command => command === "plugin:updater|download").length;
  const installs = async () => (await calls()).filter(command => command === "plugin:updater|install").length;
  const restarts = async () => (await calls()).filter(command => command === "plugin:process|restart").length;
  const nativeProgress = (event, data = {}) => page.evaluate(({ event, data }) => window.notificationTest.updateEvent(event, data), { event, data });
  const finish = error => page.evaluate(error => window.notificationTest.finishUpdate(error), error);
  try {
    const controlsLeft = (await windowControls.boundingBox()).x;
    const bell = titlebar.getByRole("button", { name: /^Notifications\b/i });
    await bell.waitFor();
    const menuRight = await titlebar.getByRole("menubar", { name: "Application" }).evaluate(element => element.getBoundingClientRect().right);
    const top = await workspaceTop(page);
    await page.waitForFunction(() => window.notificationTest.discoveryPending());
    const frames = await page.evaluate(() => {
      const bounds = () => {
        const surface = document.querySelector(".desktop-notification-center").getBoundingClientRect();
        return [surface.left, surface.right];
      };
      const frames = [bounds()];
      window.notificationTest.revealUpdate();
      return new Promise(resolve => {
        const end = performance.now() + 500;
        const record = time => {
          frames.push(bounds());
          if (time >= end) resolve(frames);
          else requestAnimationFrame(record);
        };
        requestAnimationFrame(record);
      });
    });
    await trigger.waitFor();
    const [[bellLeft]] = frames;
    const [updateLeft, updateRight] = frames.at(-1);
    assert.ok(updateRight > updateLeft, "The update face has room for its label");
    assert.ok(frames.every(([left, right]) => Math.abs((left + right) / 2 - viewport.width / 2) <= 1),
      "The island remains centered throughout the update reveal");
    assert.ok(updateLeft > menuRight && updateRight < controlsLeft, "The expanded face fits between menus and window controls");
    if (motion && Math.abs(updateLeft - bellLeft) > 5) {
      const incomingLeft = Math.min(bellLeft, updateLeft);
      const outgoingLeft = Math.max(bellLeft, updateLeft);
      assert.ok(frames.some(([left]) => left > incomingLeft + 1 && left < outgoingLeft - 1),
        "The update face eases between its compact widths");
    }
    assert.equal(await workspaceTop(page), top, "Update discovery does not reserve expanded details space");
    assert.equal((await calls()).filter(command => command === "plugin:updater|check").length, 1, "Startup discovers the signed update once");
    assert.equal(await page.locator(".rail-update-trigger").count(), 0);
    assert.ok(await trigger.evaluate(element => getComputedStyle(element).backgroundImage === "none"));
    assert.equal((await windowControls.boundingBox()).x, controlsLeft, "The update trigger leaves window controls fixed");
    assert.equal(await confirmation.count(), 0, "Startup discovery stays quiet");
    await assertUpdateTriggerSpacing(trigger);

    const baseline = await islandFrame(page);
    await trigger.hover();
    assert.equal(await confirmation.count(), 0, "Hover keeps update confirmation collapsed");
    await trigger.focus();
    const confirmFrames = await captureIslandTransition(page, island, async () => {
      await page.keyboard.press("Enter");
      await confirmation.waitFor();
    });
    for (const frame of confirmFrames) assertUpdateInTitlebar(frame, baseline, viewport.width);
    const confirmWidth = confirmFrames.at(-1).island.width;
    assert.ok(confirmWidth > baseline.island.width, "Confirming gives the action and dismiss X more room");
    assert.equal(confirmFrames.some(({ island }) =>
      island.width > baseline.island.width + 2 && island.width < confirmWidth - 2), motion,
    "Inline confirmation widens through intermediate sizes when motion is enabled");
    assert.equal(await oldUpdateRegion.count(), 0, "The updater leaves the space below the title bar clear");
    assert.ok(await confirmation.evaluate(element => document.activeElement === element),
      "Opening focuses the group so a held Enter does not start the update");
    await page.keyboard.press("Tab");
    assert.ok(await action.evaluate(element => document.activeElement === element));
    await assertNoUpdateWrites(page);
    await page.keyboard.press("Escape");
    await confirmation.waitFor({ state: "hidden" });
    await trigger.waitFor();
    assert.ok(await trigger.evaluate(element => document.activeElement === element));

    await openApplicationMenuItem(titlebar, "View", "Notifications");
    const notification = panel.getByRole("button", { name: /^Delight Client update available/i });
    await notification.waitFor();
    await assertNotificationWidth(panel);
    await notification.click();
    await page.waitForFunction(() => window.notificationTest.discoveryPending());
    await page.evaluate(() => window.notificationTest.revealUpdate());
    await confirmation.waitFor();
    await panel.waitFor({ state: "hidden" });
    await dismiss.click();
    await confirmation.waitFor({ state: "hidden" });
    await trigger.waitFor();
    assert.ok(await trigger.evaluate(element => document.activeElement === element));

    await trigger.click();
    await confirmation.waitFor();
    await page.locator(".app-shell > main").click({ position: { x: 12, y: 12 } });
    await confirmation.waitFor({ state: "hidden" });
    await trigger.waitFor();

    await page.evaluate(() => window.notificationTest.sendLaunch({ state: "launching", progress: 36, instanceId: "meadow", launchId: "while-available", message: "" }));
    await progress.waitFor();
    assert.equal(await progress.getAttribute("aria-valuenow"), "36");
    assert.equal(await trigger.count(), 0, "The approved Minecraft pill takes precedence over the update trigger");
    await page.evaluate(() => window.notificationTest.sendLaunch({ state: "cancelled", progress: 0, instanceId: "meadow", launchId: "while-available", message: "" }));
    await trigger.waitFor();

    await page.evaluate(() => window.notificationTest.sendProcess(true));
    await trigger.click();
    await confirmation.getByText("Close Minecraft to update", { exact: true }).waitFor();
    assert.equal(await action.count(), 0, "A running game blocks the launcher update inline");
    await assertNoUpdateWrites(page);
    await dismiss.click();
    await page.evaluate(() => window.notificationTest.sendProcess(false));

    await openUpdateSettings(page);
    await page.getByRole("button", { name: "View update", exact: true }).click();
    await confirmation.waitFor();
    await assertNoUpdateWrites(page);
    const updateBaseline = await islandFrame(page);
    await action.click();
    await updateProgress.waitFor();
    await confirmation.waitFor({ state: "hidden" });
    await page.waitForFunction(() => window.notificationTest.updatePending());
    await page.evaluate(() => window.notificationTest.sendLaunch({ state: "launching", progress: 8, instanceId: "meadow", launchId: "stale-native-launch", message: "" }));
    assert.equal(await progress.count(), 0, "An active update takes precedence over launch progress");
    await page.evaluate(() => window.notificationTest.sendLaunch({ state: "cancelled", progress: 0, instanceId: "meadow", launchId: "stale-native-launch", message: "" }));
    await nativeProgress("Started", {});
    await updateStatus("Downloading…").waitFor();
    assert.equal(await updateProgress.getAttribute("aria-valuenow"), null, "An unknown total stays indeterminate");
    await updateProgress.locator(".desktop-notification-launch-track[data-indeterminate]").waitFor();
    assertUpdateInTitlebar(await islandFrame(page), updateBaseline, viewport.width);
    assert.equal(await downloads(), 1);
    assert.equal(await installs(), 0, "A file still downloading cannot be installed");
    await page.keyboard.press("Escape");
    assert.equal(await updateProgress.isVisible(), true, "Escape leaves active progress visible");
    await finish("Fixture interrupted download");
    await confirmRetry("Update interrupted", "Try again");
    await page.waitForFunction(() => window.notificationTest.updatePending());
    assert.equal(await downloads(), 2, "Try again starts exactly one new download");

    await nativeProgress("Started", { contentLength: 2000 });
    await nativeProgress("Progress", { chunkLength: 900 });
    await updateStatus("45%").waitFor();
    assert.equal(await updateProgress.getAttribute("aria-valuenow"), "45");
    await page.waitForFunction(() => {
      const track = document.querySelector('[aria-label="Updating Delight Client"] .desktop-notification-launch-track');
      const fill = track?.firstElementChild;
      return fill && Math.abs(fill.getBoundingClientRect().width / track.getBoundingClientRect().width - 0.45) < 0.01;
    });
    const partial = await readPercentGeometry("45%");
    assert.ok(partial.gap >= 6 && partial.gap <= 18, "The percent slot hugs the track. Gap: " + partial.gap + "px");
    await nativeProgress("Progress", { chunkLength: 1100 });
    await updateStatus("100%").waitFor();
    const full = await readPercentGeometry("100%");
    assert.ok(Math.abs(partial.right - full.right) <= 1, "The download percentage stays anchored as digits change");
    assert.ok(Math.abs(partial.trackWidth - full.trackWidth) <= 1, "The track keeps its length as digits change");
    await nativeProgress("Finished");
    assert.equal(await installs(), 0, "The Finished event waits for signed-download completion");
    await finish();
    await page.waitForFunction(() => window.notificationTest.installationPending());
    await updateStatus("Installing…").waitFor();
    assert.equal(await updateProgress.getAttribute("aria-valuenow"), null);
    assert.equal(await installs(), 1);
    await page.evaluate(() => window.notificationTest.finishInstallation("Fixture interrupted installation"));
    await confirmRetry("Update interrupted", "Try again");
    await page.waitForFunction(() => window.notificationTest.installationPending());
    assert.equal(await downloads(), 2, "A verified download is reused if installation fails");
    assert.equal(await installs(), 2);
    await page.evaluate(() => {
      window.notificationTest.rejectNextRestart();
      window.notificationTest.finishInstallation();
    });
    await confirmRetry("Restart to finish", "Restart now");
    await page.waitForFunction(() =>
      window.notificationTest.calls.filter(call => call.command === "plugin:process|restart").length === 2);
    await updateStatus("Restarting…").waitFor();
    assertUpdateInTitlebar(await islandFrame(page), updateBaseline, viewport.width);
    assert.equal(await restarts(), 2);
    assert.equal(await downloads(), 2, "A failed restart never repeats a download");
    assert.equal(await installs(), 2, "A failed restart never repeats a successful installation");
    await assertCentered(island, viewport.width, "Restart feedback stays centered");
    assert.equal((await windowControls.boundingBox()).x, controlsLeft);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

function relativeLuminance(rgb) {
  const linear = rgb.map(channel => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

async function checkClientNotice(theme, viewport, motion, target = url) {
  const { page, errors } = await openFixture(theme, viewport, motion, { target, media: true });
  const { titlebar, island, progress } = surfaces(page);
  const media = titlebar.getByRole("group", { name: "Now Playing" });
  const trigger = titlebar.getByRole("button", { name: "Delight notice", exact: true });
  const detail = titlebar.getByRole("region", { name: "Delight notice", exact: true });
  const preview = trigger.locator(".desktop-island-notice-preview");
  const settle = () => island.evaluate(element =>
    Promise.allSettled(element.getAnimations({ subtree: true }).map(animation => animation.finished)));
  const publish = (id, message, remaining) => page.evaluate(({ id, message, remaining }) => {
    const serverTime = Date.now() + 3_600_000;
    window.notificationTest.setClientNotice(id ? {
      id, message, createdAt: serverTime - 30_000, expiresAt: serverTime + remaining,
    } : null);
  }, { id, message, remaining });
  const launch = state => page.evaluate(state => window.notificationTest.sendLaunch({
    state, progress: 24, instanceId: "meadow", launchId: "notice-launch", message: "",
  }), state);
  const firstTwelveWords = "The launcher will restart soon so please save your progress before you";
  const message = firstTwelveWords + " continue playing.\n<em>A scheduled maintenance window will start shortly. Please close any open games, then check Delight for the next update.</em>";
  const iconCenter = frame => frame.noticeIcon && frame.noticeIcon.x + frame.noticeIcon.width / 2;
  try {
    await media.waitFor();
    await launch("launching");
    await progress.waitFor();
    await publish("first", message, 30_000);
    assert.equal(await trigger.count(), 0, "A notice leaves active launch controls available");
    await launch("cancelled");

    await trigger.waitFor();
    await settle();
    const compact = await islandFrame(page);
    assert.equal(await media.count(), 0, "The active notice gets the single island slot");
    assert.equal(await trigger.locator("svg.desktop-island-notice-icon").count(), 1);
    const previewText = await preview.textContent();
    assert.match(previewText, /(?:…|\.\.\.)$/, "A long notice ends its preview with an ellipsis");
    assert.equal(previewText.replace(/\s*(?:…|\.\.\.)$/, ""), firstTwelveWords,
      "A long notice includes twelve complete words before the ellipsis");
    assert.equal(await preview.evaluate(element => getComputedStyle(element).textOverflow), "ellipsis",
      "The preview can also ellipsize when the available header width is tight");
    if (viewport.width >= 1440) {
      assert.ok(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
        "All twelve preview words fit on a wide desktop");
    }

    const leadingIcon = iconCenter(compact);
    assert.ok(leadingIcon < viewport.width / 2 - 16, "The compact warning sits at the leading edge");

    const frames = await captureIslandTransition(page, island, async () => {
      await trigger.click();
      await detail.waitFor();
    });
    assertIslandTransition(frames, viewport.width, motion, true, "notice");
    await assertOverWorkspace(detail, compact, viewport.width);
    assert.equal(await detail.textContent(), message, "Opening preserves the full plain-text message and line breaks");
    assert.equal(await detail.locator("em").count(), 0);
    assert.equal(await trigger.getAttribute("aria-expanded"), "true");

    const slowTransition = await island.locator(".desktop-island-surface").evaluate(element =>
      getComputedStyle(element).transitionDuration.split(",").some(value => {
        const duration = value.trim();
        return parseFloat(duration) * (duration.endsWith("ms") ? 1 : 1000) >= 400;
      }));
    assert.equal(slowTransition, motion, "The notice uses a slower surface transition when motion is enabled");
    const expanded = frames.at(-1);
    const expandedIcon = iconCenter(expanded);
    const expandedTextY = expanded.noticeMessage.y;
    assert.ok(Math.abs(expandedIcon - viewport.width / 2) <= 1, "The warning ends centered in the open island");
    assert.ok(expandedTextY >= compact.titlebar.y + compact.titlebar.height - 2,
      "The full message ends below the title bar");
    assert.equal(frames.some(frame => {
      const center = iconCenter(frame);
      return center !== null && center > leadingIcon + 2 && center < expandedIcon - 2;
    }), motion, "The icon travels to the center only when motion is enabled");
    const earlierTextYs = frames.filter(frame => frame.noticeMessage).map(frame => frame.noticeMessage.y);
    assert.equal(earlierTextYs.some(y => y < expandedTextY - 3), motion,
      "The full message glides down from above its reading position when motion is enabled");
    if (motion) {
      const firstTextY = Math.min(...earlierTextYs);
      assert.ok(earlierTextYs.some(y => y > firstTextY + 1 && y < expandedTextY - 1),
        "The full message reaches intermediate positions between the top and its reading position");
    }

    const closingFrames = await captureIslandTransition(page, island, async () => {
      await page.keyboard.press("Escape");
      await detail.waitFor({ state: "hidden" });
    });
    assert.ok(Math.abs(iconCenter(closingFrames.at(-1)) - leadingIcon) <= 1,
      "Closing returns the warning to the compact pill's leading edge");
    await trigger.click();
    await detail.waitFor();
    await publish(null);
    await media.waitFor();
    assert.equal(await detail.count(), 0, "Ending a notice clears an open detail panel");

    await publish("short", "Maintenance complete.", 2750);
    await trigger.waitFor();
    await settle();
    assert.equal(await preview.textContent(), "Maintenance complete.", "A short notice uses its complete line");
    assert.ok(await preview.evaluate(element => element.scrollWidth <= element.clientWidth + 1),
      "The compact pill leaves enough room for short notice text");
    await trigger.click();
    await detail.locator(".desktop-island-notice-message").focus();
    await media.waitFor({ timeout: 5500 });
    assert.equal(await trigger.count(), 0, "The focused notice expires locally before the next poll");
    assert.ok(await media.evaluate(element => element.contains(document.activeElement)),
      "Focus returns to the restored Now Playing controls when an open notice expires");
    assertFixedWorkspace(await islandFrame(page), compact);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkIslandColors(target = url) {
  const { page, errors } = await openFixture("oled", { width: 1440, height: 900 }, false, { target });
  const { titlebar, bell, panel } = surfaces(page);
  const colorButton = page.getByRole("button", { name: "Choose island color", exact: true });
  const picker = page.getByRole("dialog", { name: "Island color", exact: true });
  const themeChoices = page.getByRole("group", { name: "Theme", exact: true });
  const openAppearance = () => openApplicationMenuItem(titlebar, "Edit", "Client settings");
  const sampleColors = () => page.evaluate(() => {
    const surface = document.querySelector(".desktop-island-surface");
    const trigger = surface.querySelector(".desktop-notification-trigger");
    const titlebar = document.querySelector(".desktop-titlebar");
    const sideRail = document.querySelector(".desktop-rail");
    const context = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
    const sample = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    return {
      surface: sample(getComputedStyle(surface).backgroundColor),
      text: sample(getComputedStyle(trigger).color),
      rails: [titlebar, sideRail].map(rail => sample(getComputedStyle(rail).backgroundColor)),
    };
  });
  const assertColor = async expected => {
    const colors = await sampleColors();
    assert.deepEqual(colors.surface, expected, "The chosen color paints the island surface");
    const [darker, lighter] = [relativeLuminance(colors.surface), relativeLuminance(colors.text)].sort((a, b) => a - b);
    assert.ok((lighter + 0.05) / (darker + 0.05) >= 4.5, "Island controls offer readable contrast against the chosen color");
    return colors;
  };
  const chooseColor = async value => {
    await colorButton.click();
    await picker.getByRole("textbox", { name: "Hex color", exact: true }).fill(value);
    await picker.getByRole("button", { name: "Apply color", exact: true }).click();
  };

  try {
    await bell.waitFor();
    const darkDefault = await assertColor([5, 5, 5]);
    assert.ok(darkDefault.rails.every(rail => relativeLuminance(darkDefault.surface) < relativeLuminance(rail)), "The default island is darker than both dark-mode rails");
    await openAppearance();
    await chooseColor("#C8DEF4");
    assert.deepEqual((await assertColor([200, 222, 244])).rails, darkDefault.rails, "Changing the island color leaves both rails alone");
    await bell.click();
    await panel.waitFor();
    await assertColor([200, 222, 244]);
    await page.keyboard.press("Escape");

    await themeChoices.getByRole("button", { name: "Light", exact: true }).click();
    const lightDefault = await assertColor([5, 5, 5]);
    assert.ok(lightDefault.rails.every(rail => relativeLuminance(lightDefault.surface) < relativeLuminance(rail)), "The default island is darker than both light-mode rails");
    await chooseColor("#19304A");
    assert.deepEqual((await assertColor([25, 48, 74])).rails, lightDefault.rails, "The light rails keep their own colors");
    await page.reload({ waitUntil: "domcontentloaded" });
    await bell.waitFor();
    await assertColor([25, 48, 74]);
    await openAppearance();
    await themeChoices.getByRole("button", { name: "Dark", exact: true }).click();
    await assertColor([200, 222, 244]);
    await page.getByRole("button", { name: "Reset appearance", exact: true }).click();
    await assertColor([5, 5, 5]);
    await themeChoices.getByRole("button", { name: "Light", exact: true }).click();
    await assertColor([5, 5, 5]);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkNowPlaying(theme, viewport, motion, target) {
  const { page, errors } = await openFixture(theme, viewport, motion, { target });
  const { titlebar, island, bell, panel, progress } = surfaces(page);
  const media = titlebar.locator(".desktop-island-media-face");
  const artist = media.locator(".desktop-island-media-artist");
  const volume = media.getByRole("button", { name: "Volume", exact: true });
  const slider = media.getByRole("slider", { name: "App volume", exact: true });
  const mediaCalls = command => page.evaluate(command =>
    window.notificationTest.calls.filter(call => call.command === command), command);
  const waitForLevel = level => page.waitForFunction(value =>
    document.querySelector('input[aria-label="App volume"]')?.valueAsNumber === value, level);
  const sendLaunch = state => page.evaluate(state => window.notificationTest.sendLaunch({
    state, progress: 68, instanceId: "meadow", launchId: "media-launch", message: "",
  }), state);
  const settleWidth = () => island.evaluate(element => Promise.allSettled(element.getAnimations().map(animation => animation.finished)));

  try {
    await bell.waitFor();
    assert.deepEqual(await mediaCalls("start_now_playing"), [], "Media observation defaults to off");
    await openApplicationMenuItem(titlebar, "Edit", "Client settings");
    const toggle = page.getByRole("button", { name: "Show Now Playing", exact: true });
    await toggle.waitFor();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false");
    await toggle.click();
    await media.waitFor();
    await settleWidth();
    await assertCentered(island, viewport.width, "Now Playing occupies the centered slot");
    assert.equal(await media.locator(".desktop-island-media-title").textContent(), "Test track");
    assert.match(await artist.textContent(), /Test artist/);
    const appIcon = media.locator("img.desktop-island-media-app");
    await appIcon.waitFor();
    const iconSource = await appIcon.getAttribute("src");
    assert.ok(await appIcon.evaluate(image => image.complete && image.naturalWidth > 0), "The native app logo is shown in the row");
    assert.equal(await appIcon.locator("..").locator(":scope > svg").count(), 0, "No generic glyph is painted behind the app logo");
    await page.evaluate(() => window.notificationTest.setMedia({ appIcon: "data:image/png;base64,invalid" }));
    await appIcon.waitFor({ state: "hidden" });
    assert.equal(await appIcon.evaluate(image => image.getBoundingClientRect().width), 0, "An invalid image leaves no logo slot");
    await page.evaluate(() => window.notificationTest.setMedia({ appIcon: null }));
    await appIcon.waitFor({ state: "detached" });
    assert.equal(await appIcon.locator("..").locator(":scope > svg").count(), 0, "An unresolved app has no placeholder logo");
    await page.evaluate(src => window.notificationTest.setMedia({ appIcon: src }), iconSource);
    await appIcon.waitFor();
    assert.ok(await media.getByRole("button", { name: "Previous track", exact: true }).isDisabled(),
      "An unavailable capability keeps its place in the row");
    await page.evaluate(() => window.notificationTest.setMedia({ artist: "" }));
    await artist.waitFor({ state: "detached" });
    await page.evaluate(() => window.notificationTest.setMedia({ artist: "Test artist" }));

    await openApplicationMenuItem(titlebar, "View", "Notifications");
    await panel.waitFor();
    await assertNotificationWidth(panel);
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    const longTitle = "A longer audio title that needs to be cropped in the pill ".repeat(4).trim();
    await page.evaluate(title => window.notificationTest.setMedia({ title }), longTitle);
    await media.getByText(longTitle, { exact: true }).waitFor();
    await settleWidth();
    await assertIslandClip(appIcon);
    await assertIslandClip(volume);
    await page.evaluate(() => window.notificationTest.setMedia({ title: "Test track" }));
    await media.getByText("Test track", { exact: true }).waitFor();
    const scrollTop = await page.locator(".app-shell > main").evaluate(element => {
      element.scrollTop = 180;
      return element.scrollTop;
    });
    assert.ok(scrollTop > 0, "Now Playing can be used with a scrolled workspace");
    await settleWidth();
    const baseline = await islandFrame(page);

    await media.getByRole("button", { name: "Next track", exact: true }).click();
    await media.getByRole("button", { name: "Pause", exact: true }).click();
    await media.getByRole("button", { name: "Play", exact: true }).click();
    assert.deepEqual((await mediaCalls("control_now_playing")).map(({ args }) => [args.sessionId, args.action]), [
      ["media-fixture", "next"], ["media-fixture", "pause"], ["media-fixture", "play"],
    ]);
    assert.equal((await islandFrame(page)).island.width, baseline.island.width, "Transport does not resize the pill");
    await volume.hover();
    assert.equal(await slider.count(), 0, "Hovering Volume leaves the pill compact");
    assert.deepEqual(await mediaCalls("get_now_playing_volume"), [], "The app mixer is read when the user opens its slider");

    const frames = await captureIslandTransition(page, island, async () => {
      await volume.click();
      await waitForLevel(37);
    });
    const open = frames.at(-1);
    assert.ok(open.island.width > baseline.island.width + 24, "Volume makes space for a horizontal slider");
    for (const frame of frames) {
      assertFixedWorkspace(frame, baseline);
      assert.ok(Math.abs(frame.island.x + frame.island.width / 2 - viewport.width / 2) <= 1,
        "The pill stays centered while Volume opens");
      assert.equal(frame.island.height, baseline.island.height);
      assert.equal(frame.island.radius, baseline.island.radius);
    }
    const eased = frames.some(({ island }) => island.width > baseline.island.width + 2 && island.width < open.island.width - 2);
    assert.equal(eased, motion, "Horizontal volume respects motion preferences");

    await page.evaluate(() => window.notificationTest.setMixerVolume({ level: 0.57, muted: false }));
    await waitForLevel(57);
    const sliderBox = await slider.boundingBox();
    const y = sliderBox.y + sliderBox.height / 2;
    await page.mouse.move(sliderBox.x + sliderBox.width * 0.57, y);
    await page.mouse.down();
    await page.mouse.move(sliderBox.x + sliderBox.width * 0.83, y, { steps: 4 });
    await page.waitForFunction(() => window.notificationTest.calls.some(call =>
      call.command === "set_now_playing_volume" && call.args.level > 0.7));
    await page.mouse.move(sliderBox.x + sliderBox.width * 0.32, y, { steps: 4 });
    await page.waitForFunction(() => window.notificationTest.calls.filter(call =>
      call.command === "set_now_playing_volume").at(-1)?.args.level < 0.45);
    await page.mouse.up();
    const volumeWrites = await mediaCalls("set_now_playing_volume");
    assert.ok(volumeWrites.every(call => call.args.sessionId === "media-fixture" && call.args.observationId && call.args.scope === "app"));
    await slider.evaluate(input => {
      window.notificationTest.setMixerVolume(null);
      window.notificationTest.setPcVolume({ level: 0.51, muted: false, targetId: "fixture-speakers" });
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "75");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const pcSlider = media.getByRole("slider", { name: "PC volume", exact: true });
    await pcSlider.waitFor();
    assert.equal(await pcSlider.inputValue(), "51", "An in-progress app drag cannot touch the PC output");
    assert.equal(await media.getByText("PC", { exact: true }).count(), 1, "The fallback is visibly labeled");
    await pcSlider.fill("67");
    await page.waitForFunction(() => window.notificationTest.calls.some(call =>
      call.command === "set_now_playing_volume" && call.args.scope === "system" &&
      call.args.targetId === "fixture-speakers" && call.args.level === 0.67));
    await pcSlider.evaluate(input => {
      window.notificationTest.setPcVolume({ level: 0.43, muted: false, targetId: "fixture-headphones" });
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(input, "90");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForFunction(() => document.querySelector('input[aria-label="PC volume"]')?.valueAsNumber === 43);
    await pcSlider.focus();
    await page.keyboard.press("Escape");
    await pcSlider.waitFor({ state: "hidden" });
    assert.equal(await volume.evaluate(button => document.activeElement === button), true, "Escape restores the volume button focus");
    await page.evaluate(() => window.notificationTest.setPcVolume(null));
    await volume.click();
    await media.getByText("Volume unavailable", { exact: true }).waitFor();
    assert.equal(await slider.count(), 0, "An unverified mixer never shows a default volume");

    await sendLaunch("launching");
    await progress.waitFor();
    assert.equal(await media.count(), 0, "A launch takes the single slot away from media");
    assertFixedWorkspace(await islandFrame(page), baseline);
    await sendLaunch("cancelled");
    await media.waitFor();
    await page.evaluate(() => window.notificationTest.setMedia(null));
    await bell.waitFor();
    await toggle.click();
    await page.waitForFunction(() => !window.notificationTest.currentObservation());
    assert.ok((await mediaCalls("stop_now_playing")).length >= 1);
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

async function checkUpdateGate() {
  const viewport = { width: 1440, height: 900 };
  const { page, errors } = await openFixture("oled", viewport, true, { target: releaseUrl, update: true, media: true });
  const { titlebar, panel } = surfaces(page);
  const { trigger, confirmation, action, dismiss } = updaterSurfaces(page);
  const media = titlebar.locator(".desktop-island-media-face");
  const volume = media.getByRole("button", { name: "Volume", exact: true });
  const slider = media.getByRole("slider", { name: "App volume", exact: true });
  const reveal = outcome => page.evaluate(outcome => window.notificationTest.revealUpdate(outcome), outcome);
  const discovery = () => page.waitForFunction(() => window.notificationTest.discoveryPending());
  try {
    await media.waitFor();
    await discovery();
    await volume.click();
    await slider.waitFor();
    const staleObservation = await page.evaluate(() => window.notificationTest.currentObservation());
    await volume.hover();
    await page.mouse.down();
    await reveal();
    await trigger.waitFor();
    await page.mouse.up();
    await slider.waitFor({ state: "hidden" });
    await page.waitForFunction(() => !window.notificationTest.currentObservation());
    assert.equal(await confirmation.count(), 0, "The pending update replaces media without inheriting its in-progress click");
    await page.evaluate(observationId => window.notificationTest.emitMedia(observationId, {
      sessionId: "stale-media", title: "Stale track", isPlaying: true, canPause: true,
    }), staleObservation);
    assert.equal(await titlebar.getByText("Stale track", { exact: true }).count(), 0);
    await trigger.click();
    await action.click();
    await page.waitForFunction(() => window.notificationTest.updatePending());
    await page.evaluate(() => window.notificationTest.finishUpdate("Fixture interrupted download"));
    const interrupted = titlebar.getByRole("button", { name: "Update interrupted", exact: true });
    await interrupted.or(confirmation.getByRole("button", { name: "Try again", exact: true })).waitFor();
    await page.keyboard.press("Escape");
    await interrupted.waitFor();
    assert.equal(await media.count(), 0, "Failure and dismissal leave playback controls hidden");

    await page.reload({ waitUntil: "domcontentloaded" });
    await trigger.waitFor();
    assert.equal(await media.count(), 0, "A previously read pending update still gates the older app after restart");
    assert.equal(await page.evaluate(() => window.notificationTest.calls.filter(call => call.command === "start_now_playing").length), 0,
      "Restoring the pending update does not briefly begin media observation");
    await discovery();
    await reveal("offline");
    await openApplicationMenuItem(titlebar, "View", "Notifications");
    await panel.waitFor();
    await page.keyboard.press("Escape");
    await panel.waitFor({ state: "hidden" });
    await trigger.waitFor();
    assert.equal(await media.count(), 0, "Offline discovery and reading Notifications do not clear the gate");

    await trigger.click();
    await confirmation.getByRole("button", { name: "Check again", exact: true }).click();
    await discovery();
    await reveal();
    await action.waitFor();
    await assertNoUpdateWrites(page);
    assert.equal(await media.count(), 0, "A verified cached update still asks before installation");
    await dismiss.click();

    await openApplicationMenuItem(titlebar, "Help", "Check for updates");
    await discovery();
    await reveal("none");
    await media.waitFor();
    assert.equal(await confirmation.count(), 0);
    assert.equal(await page.evaluate(() => window.notificationTest.calls.some(({ command }) =>
      command === "reserve_launcher_update" || command === "plugin:updater|download")), false,
    "Rechecking a cached version never approves installation");
    assert.equal(await trigger.count(), 0, "An authoritative withdrawal releases the gate");

    await page.evaluate(notice => {
      window.notificationTest.setItems([{ ...notice, read: true }]);
      window.notificationTest.setRunningVersion("1.4.0");
    }, notices[3]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await media.waitFor();
    assert.equal(await trigger.count(), 0, "A restart into the newer version restores eligible playback controls");
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  await checkDevPreviewCommands(url, true);
  await checkDevPreviewWithoutArtwork();
  if (releaseUrl) await checkDevPreviewCommands(releaseUrl, false);
  console.log("Island preview commands, artwork fallback, and simulated side effects passed in the renderer.");
  await checkPanel();
  await checkProgress("oled", { width: 1440, height: 900 }, true);
  await checkProgress("light", { width: 900, height: 680 }, false);
  await checkNowPlaying("light", { width: 900, height: 680 }, false);
  await checkIslandColors();
  await checkClientNotice("light", { width: 900, height: 680 }, false);
  await checkClientNotice("oled", { width: 1440, height: 900 }, true);
  console.log("Client notice delivery, launch priority, longer previews, opening motion, reduced motion, and expiry passed in the renderer.");
  console.log("Borderless island morphs, fixed workspace, per-theme color and contrast, launch cancellation, and Now Playing passed in the renderer.");
  if (releaseUrl) {
    await checkProgress("oled", { width: 1440, height: 900 }, true, releaseUrl);
    await checkProgress("light", { width: 900, height: 680 }, false, releaseUrl);
    await checkLauncherUpdate("oled", { width: 1440, height: 900 }, true);
    await checkLauncherUpdate("light", { width: 900, height: 680 }, false);
    await checkUpdateGate();
    await checkNowPlaying("oled", { width: 1440, height: 900 }, true, releaseUrl);
    await checkIslandColors(releaseUrl);
    await checkClientNotice("oled", { width: 1440, height: 900 }, true, releaseUrl);
    console.log("Inline launcher confirmation, progress, retry, theme colors, and Now Playing update gate passed against the production bundle.");
  }
} finally {
  await browser.close();
}
