// Exercise the real account menu with an isolated native bridge, never real accounts.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.setDefaultTimeout(12000);
const url = process.env.BLOOM_TEST_URL || 'http://localhost:1420';
const errors = []; page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(url) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem('bloom-onboarding-complete-v1', 'complete');
  localStorage.setItem('bloom-last-page', 'portal');
  localStorage.setItem('bloom-settings', JSON.stringify({ theme: 'oled', animations: true, accent: '#5998ff', buttonPressDuration: 0, startupBehavior: 'Remember last page', ...JSON.parse(localStorage.getItem('logout-test-prefs') || '{}') }));
  const callbacks = new Map(), listeners = new Map(); let next = 1;
  const profile = { id: 'test-account', name: 'Test' };
  window.logoutTest = { calls: [], signedOut: false, fail: false, delay: false, finish: null };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback(fn) { const id = next++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.logoutTest.calls.push({ command, args });
      if (command === 'get_saved_minecraft_profile') return window.logoutTest.signedOut ? null : profile;
      if (command === 'list_minecraft_accounts') return { activeId: window.logoutTest.signedOut ? null : profile.id, accounts: window.logoutTest.signedOut ? [] : [profile] };
      if (command === 'sign_out_minecraft') {
        if (window.logoutTest.delay) await new Promise(resolve => window.logoutTest.finish = resolve);
        if (window.logoutTest.fail) throw 'Could not sign out. Try again.';
        window.logoutTest.signedOut = true; return null;
      }
      if (command === 'list_portal') return { entries: [], warnings: [] };
      if (command === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) || []), args.handler]); return next++; }
      if (command === 'get_minecraft_process_running' || command === 'plugin:window|is_maximized') return false;
      if (command === 'get_minecraft_launch_status') return { active: false, state: 'idle', progress: 0, message: '' };
      if (command === 'get_content_download_queue') return { revision: 0, tasks: [] };
      if (command === 'plugin:app|version') return '1.1.8';
      if (command === 'get_minecraft_releases') return [{ id: '26.3', type: 'release' }];
      if (command === 'cosmetics_request') return { items: [] };
      if (['list_instances', 'list_instance_content', 'list_pack_channel_memberships', 'reconcile_cosmetics', 'list_cached_screenshots', 'detect_java_installations', 'list_instance_folders', 'list_managed_java_runtimes'].includes(command)) return [];
      return null;
    }
  };
});
await mkdir('logs/logout-undo', { recursive: true });
const shot = name => page.screenshot({ path: `logs/logout-undo/${name}.png`, fullPage: true, animations: 'disabled' });
const calls = () => page.evaluate(() => window.logoutTest.calls.filter(call => call.command === 'sign_out_minecraft').length);
const logOut = () => page.getByRole('menuitem', { name: 'Log out', exact: true });
const undo = () => page.getByRole('menuitem', { name: 'Undo log out', exact: true });
const openMenu = async () => { await page.locator('.profile-trigger').click(); await logOut().waitFor(); };
try {
  await page.clock.install({ time: new Date('2026-11-18T17:00:00Z') });
  await page.goto(url); await page.locator('.signed-in-name').waitFor();
  await page.clock.pauseAt(new Date('2026-11-18T17:01:00Z'));
  await openMenu(); await shot('idle');
  const before = await logOut().boundingBox();
  await logOut().click(); await undo().waitFor(); assert.equal(await calls(), 0);
  const after = await undo().boundingBox(); assert.equal(after.width, before.width); assert.equal(after.height, before.height);
  await page.clock.fastForward(2200);
  const offset = Number(await page.locator('.logout-countdown path').getAttribute('stroke-dashoffset'));
  assert.ok(offset <= -40 && offset > -60, `expected an actual countdown arc, got ${offset}`);
  await shot('undo-ring');
  await undo().click(); await page.clock.fastForward(6000); assert.equal(await calls(), 0); await logOut().waitFor();
  await logOut().focus(); await page.keyboard.press('Space'); await undo().waitFor(); await page.keyboard.press('Enter');
  await page.clock.fastForward(6000); assert.equal(await calls(), 0);
  // Closing the menu must cancel a request whose Undo button is no longer available.
  await logOut().click(); await page.keyboard.press('Escape'); await page.clock.fastForward(6000); assert.equal(await calls(), 0);
  await openMenu(); await logOut().click(); await page.getByRole('button', { name: 'Home', exact: true }).click();
  await page.clock.fastForward(6000); assert.equal(await calls(), 0);
  // Switching to account settings closes the menu and cancels the queued logout.
  await openMenu(); await logOut().click(); await page.getByRole('menuitem', { name: 'Profile & accounts' }).click();
  await page.clock.fastForward(6000); assert.equal(await calls(), 0);
  // Errors must preserve the account and permit a fresh attempt.
  await openMenu(); await page.evaluate(() => window.logoutTest.fail = true); await logOut().click();
  await page.clock.fastForward(5000); await page.getByText('Could not sign out. Try again.', { exact: true }).waitFor();
  assert.equal(await calls(), 1); assert.equal(await page.locator('.signed-in-name').isVisible(), true);
  await page.clock.fastForward(4100); // Let the existing error toast leave the account dock.
  await page.evaluate(() => { window.logoutTest.fail = false; window.logoutTest.delay = true; });
  await openMenu(); await logOut().click(); await page.clock.fastForward(5000);
  await page.getByRole('menuitem', { name: 'Signing out', exact: true }).waitFor();
  assert.equal(await page.getByRole('menuitem', { name: 'Signing out', exact: true }).isDisabled(), true);
  await page.clock.fastForward(7000); assert.equal(await calls(), 2);
  await page.evaluate(() => window.logoutTest.finish()); await page.locator('.signin-button').waitFor();
  await shot('signed-out'); assert.equal(await calls(), 2);
  // The undo window remains five seconds when motion is reduced or disabled.
  for (const [name, prefs, reduced] of [
    ['animations-off', { animations: false }, false],
    ['ultra', { ultraPerformance: true }, false],
    ['reduced-motion', {}, true],
    ['light-compact', { theme: 'light' }, false],
  ]) {
    await page.evaluate(prefs => localStorage.setItem('logout-test-prefs', JSON.stringify(prefs)), prefs);
    await page.emulateMedia({ reducedMotion: reduced ? 'reduce' : 'no-preference' });
    await page.setViewportSize(name === 'light-compact' ? { width: 900, height: 740 } : { width: 1280, height: 800 });
    await page.reload(); await page.clock.fastForward(500); await page.locator('.signed-in-name').waitFor();
    if (name === 'light-compact') await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await openMenu(); await logOut().click(); await page.clock.fastForward(2200); await undo().waitFor();
    assert.equal(await calls(), 0);
    if (name !== 'light-compact') assert.equal(await page.locator('.logout-countdown path').evaluate(el => getComputedStyle(el).transitionDuration), '0s');
    const ringBox = await undo().boundingBox(); const menuBox = await page.getByRole('menu', { name: 'Account menu' }).boundingBox();
    assert.ok(ringBox.y + ringBox.height <= menuBox.y + menuBox.height + 1, `${name} clips the Undo button`);
    await shot(name); await undo().click(); await page.clock.fastForward(6000); assert.equal(await calls(), 0);
  }
  assert.deepEqual(errors, []);
  console.log('Logout undo passed: no early native call; actual countdown; Undo and keyboard cancel; Escape/outside/settings cancellation; error recovery; single in-flight request; eventual native sign-out; reduced/off/Ultra timing; compact Light ring containment.');
} catch (error) { console.log('Browser errors:', errors); await shot('failure'); throw error; }
finally { await browser.close(); }
