import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";

const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || "playwright");
const browser = await chromium.launch({
  ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}),
});
const url = process.env.BLOOM_TEST_URL || "http://localhost:1420";

async function checkStorage(theme, viewport) {
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/*", route =>
    route.request().url().startsWith(url) || route.request().url().startsWith("data:")
      ? route.continue()
      : route.abort());
  await page.addInitScript(theme => {
    localStorage.setItem("bloom-onboarding-complete-v1", "complete");
    localStorage.setItem("bloom-settings", JSON.stringify({ theme, animations: false, redesignAppearanceV1: true }));
    let callback = 0;
    let archiveBytes = 2048;
    const fixture = window.storageTest = { calls: [], pause: false, finish: null, busy: true };
    window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    window.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => ++callback,
      unregisterCallback() {},
      convertFileSrc: file => file,
      async invoke(command, args) {
        fixture.calls.push({ command, args });
        switch (command) {
          case "plugin:event|listen": return ++callback;
          case "plugin:app|version": return "1.3.3";
          case "get_minecraft_launch_status": return { active: false, progress: 0, state: "idle" };
          case "get_minecraft_process_running":
          case "plugin:window|is_maximized": return false;
          case "list_minecraft_accounts": return { accounts: [], activeId: null };
          case "get_minecraft_releases":
          case "detect_java_installations":
          case "reconcile_cosmetics": return [];
          case "get_client_cache_status":
            return { directory: "D:\\Delight\\BloomCache", capacityBytes: 2147483648, usedBytes: 384 * 1024 ** 2, itemCount: 5 };
          case "get_storage_usage":
            if (fixture.pause) await new Promise(resolve => { fixture.finish = resolve; });
            return {
              totalBytes: 8303 * 1024 ** 2 + archiveBytes,
              minecraftBytes: 2048 * 1024 ** 2, cacheBytes: 384 * 1024 ** 2, skipped: 1, moreCleanup: false,
              instances: [
                { id: "fabric", name: "Fabric workshop", bytes: 5000 * 1024 ** 2 + archiveBytes,
                  worlds: 2560 * 1024 ** 2, packs: 1900 * 1024 ** 2, screenshots: 114 * 1024 ** 2,
                  logs: archiveBytes, other: 426 * 1024 ** 2 },
                { id: "vanilla", name: "Vanilla", bytes: 871 * 1024 ** 2,
                  worlds: 871 * 1024 ** 2, packs: 0, screenshots: 0, logs: 0, other: 0 },
              ],
              cleanup: archiveBytes ? [{ id: "old-log", name: "2026-09-22-1.log.gz", location: "Fabric workshop",
                bytes: archiveBytes, modifiedMs: Date.UTC(2026, 8, 22) }] : [],
            };
          case "clean_reviewed_storage":
            if (fixture.busy) throw "Close Minecraft and wait for downloads to finish before cleaning up.";
            archiveBytes = 0;
            return { removed: 1, removedBytes: 2048, skipped: 0 };
          default: return command.startsWith("list_") ? [] : null;
        }
      },
    };
  }, theme);
  try {
    await page.goto(url);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.getByRole("menuitem", { name: "Client settings", exact: true }).click();
    const storage = page.getByRole("region", { name: "Storage breakdown" });
    await page.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Storage", exact: true }).click();
    await storage.getByText("Shared Minecraft downloads").waitFor();
    const chart = storage.locator(".storage-usage-chart");
    const segments = await chart.evaluate(element => {
      const bar = element.querySelector(".storage-usage-bar");
      return [...bar.children].map(segment => {
        const key = segment.dataset.storageCategory;
        const swatch = element.querySelector(`.storage-usage-legend [data-storage-category="${key}"] .storage-usage-swatch`);
        return {
          key,
          ratio: segment.getBoundingClientRect().width / bar.getBoundingClientRect().width,
          fill: getComputedStyle(segment).backgroundImage,
          swatch: getComputedStyle(swatch).backgroundImage,
        };
      });
    });
    assert.equal(segments.length, 7);
    assert.equal(new Set(segments.map(segment => segment.fill)).size, 7);
    assert.ok(segments.every(segment => segment.fill.startsWith("linear-gradient") && segment.fill === segment.swatch));
    assert.ok(Math.abs(segments.find(segment => segment.key === "worlds").ratio - 3431 / 8303) < .001);
    assert.ok(Math.abs(segments.find(segment => segment.key === "minecraft").ratio - 2048 / 8303) < .001);
    assert.ok(Math.abs(segments.find(segment => segment.key === "cache").ratio - 384 / 8303) < .001);
    const meterStyle = locator => locator.evaluate(element => {
      const style = getComputedStyle(element);
      return [style.height, style.borderRadius, style.backgroundColor];
    });
    const cacheMeter = page.locator(".storage-overview .storage-meter");
    assert.deepEqual(await meterStyle(chart.locator(".storage-usage-bar")), await meterStyle(cacheMeter));
    assert.equal(segments.find(segment => segment.key === "cache").fill,
      await cacheMeter.locator(".storage-meter-fill").evaluate(element => getComputedStyle(element).backgroundImage));
    await mkdir("logs/storage-breakdown", { recursive: true });
    await page.screenshot({ path: `logs/storage-breakdown/${theme}-bar.png` });
    assert.deepEqual(await storage.locator(".storage-breakdown-instances summary > span").allTextContents(), ["Fabric workshop", "Vanilla"]);
    const instance = storage.locator(".storage-breakdown-instances details").filter({ hasText: "Fabric workshop" });
    await instance.getByText("Fabric workshop", { exact: true }).click();
    await instance.getByText("Worlds", { exact: true }).waitFor();
    assert.equal(await instance.getByText("2.50 GB").count(), 1);
    await storage.getByRole("button", { name: "Open folder for Fabric workshop" }).click();
    assert.ok(await page.evaluate(() => window.storageTest.calls.some(call =>
      call.command === "open_instance_folder" && call.args.instanceId === "fabric")));
    assert.equal(await page.getByRole("button", { name: "Clear cache", exact: true }).count(), 1);
    assert.equal(await storage.getByText("The total is partial.", { exact: false }).count(), 1);

    await storage.getByText("Review cleanup", { exact: true }).click();
    const remove = storage.getByRole("button", { name: "Remove selected" });
    assert.equal(await remove.isDisabled(), true);
    await storage.getByRole("checkbox", { name: /2026-09-22-1/ }).check();
    assert.equal(await storage.getByText("2.0 KB selected").count(), 1);
    await mkdir("logs/storage-breakdown", { recursive: true });
    await page.screenshot({ path: `logs/storage-breakdown/${theme}.png` });
    await remove.click();
    await storage.getByRole("alert").filter({ hasText: "Close Minecraft" }).waitFor();
    assert.equal(await storage.getByRole("checkbox", { name: /2026-09-22-1/ }).isChecked(), true);
    await page.evaluate(() => { window.storageTest.busy = false; });
    await remove.click();
    await storage.getByText("Removed 1 file · 2.0 KB freed.").waitFor();
    await storage.getByText("No archived logs", { exact: false }).waitFor();
    assert.equal(await chart.locator('.storage-usage-bar [data-storage-category="logs"]').count(), 0);
    assert.equal(await chart.locator('.storage-usage-legend [data-storage-category="logs"] small').textContent(), "0 B");
    const requests = await page.evaluate(() => window.storageTest.calls.filter(call => call.command === "clean_reviewed_storage"));
    assert.deepEqual(requests.map(request => request.args.ids), [["old-log"], ["old-log"]]);

    await page.evaluate(() => { window.storageTest.pause = true; });
    const refresh = storage.getByRole("button", { name: "Refresh", exact: true });
    await refresh.click();
    await storage.getByText("Scanning storage…").waitFor();
    assert.equal(await refresh.isDisabled(), true);
    await page.waitForFunction(() => typeof window.storageTest.finish === "function");
    await page.evaluate(() => window.storageTest.finish());
    await storage.getByText("Scanning storage…").waitFor({ state: "hidden" });
    assert.deepEqual(errors, []);
  } finally {
    await page.close();
  }
}

try {
  await checkStorage("oled", { width: 1440, height: 960 });
  await checkStorage("light", { width: 900, height: 680 });
  console.log("Storage proportions and legend colors, cleanup review, refresh, and cache controls passed in OLED and compact Light.");
} finally {
  await browser.close();
}
