// Real React UI with a persistent, isolated Tauri bridge. Native disk/launch tests
// live in portal.rs; this test never starts Minecraft or changes real instances.
import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
page.setDefaultTimeout(12000);
const url = process.env.BLOOM_TEST_URL || 'http://localhost:1420';
const errors = []; page.on('pageerror', e => errors.push(e.message));
await page.route('**/*', route => route.request().url().startsWith(url) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
await page.addInitScript(() => {
  localStorage.setItem('bloom-onboarding-complete-v1', 'complete');
  localStorage.setItem('bloom-settings', JSON.stringify({ theme: 'oled', accent: '#5998ff', animations: true, buttonPressDuration: 0, startupBehavior: 'Remember last page', ...JSON.parse(localStorage.getItem('portal-test-prefs') || '{}') }));
  const instances = ['Meadow', 'SMP'].map((name, i) => ({ id: String(i), name, version: '26.3', loader: 'Fabric', directory: `C:/fixture/${name}`, java: 'Automatic', memory: 4096, jvmArguments: '', mods: true, resourcePacks: true, shaderPacks: true, config: true, visible: true }));
  const entries = JSON.parse(localStorage.getItem('portal-test-entries') || 'null') || [
    { id: 'world', instanceId: '0', instanceName: 'Meadow', version: '26.3', kind: 'world', target: 'Survival World', name: 'Survival World', icon: null, lastPlayed: Date.now() - 3600000, favorite: false, removable: false, unavailableReason: null },
    { id: 'server', instanceId: '1', instanceName: 'SMP', version: '26.3', kind: 'server', target: 'play.example.com:25566', name: 'Friends', icon: null, lastPlayed: Date.now() - 7200000, favorite: true, removable: true, unavailableReason: null },
    { id: 'future', instanceId: '0', instanceName: 'Meadow', version: '26.3', kind: 'world', target: 'Future world', name: 'Future world', icon: null, lastPlayed: null, favorite: false, removable: false, unavailableReason: 'Saved in 26.4. Open this instance to review Minecraft’s version warning first.' },
  ];
  const callbacks = new Map(), listeners = new Map(); let next = 1;
  window.portalTest = { entries, calls: [], failRead: Boolean(localStorage.getItem('portal-test-fail-read')), failSave: false, failCopy: false, delayRead: false, releaseRead: null, running: false,
    emit(event, payload) { for (const handler of listeners.get(event) || []) callbacks.get(handler)?.({ event, id: 1, payload }); } };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main' } },
    transformCallback(fn) { const id = next++; callbacks.set(id, fn); return id; }, unregisterCallback(id) { callbacks.delete(id); }, convertFileSrc(path) { return path; },
    async invoke(command, args) {
      window.portalTest.calls.push({ command, args });
      const snapshot = () => ({ entries: JSON.parse(JSON.stringify(window.portalTest.entries)), warnings: [] });
      if (command === 'list_portal') {
        const result = snapshot();
        if (window.portalTest.delayRead) await new Promise(resolve => window.portalTest.releaseRead = resolve);
        if (window.portalTest.failRead) throw 'Could not read Portal. Try again.';
        return result;
      }
      if (command === 'change_portal') {
        if (window.portalTest.failSave) throw 'Could not save Portal. Try again.';
        const change = args.change;
        if (change.action === 'favorite') window.portalTest.entries.find(e => e.id === change.id).favorite = change.favorite;
        if (change.action === 'remove') window.portalTest.entries = window.portalTest.entries.filter(e => e.id !== change.id);
        if (change.action === 'addServer') { const instance = instances.find(i => i.id === change.instanceId); window.portalTest.entries.push({ id: 'added', instanceId: instance.id, instanceName: instance.name, version: instance.version, kind: 'server', target: change.address, name: change.name, icon: null, lastPlayed: null, favorite: false, removable: true, unavailableReason: null }); }
        localStorage.setItem('portal-test-entries', JSON.stringify(window.portalTest.entries)); return snapshot();
      }
      if (command === 'copy_text_to_clipboard' && window.portalTest.failCopy) throw 'Clipboard is unavailable.';
      if (command === 'list_instances') return instances;
      if (command === 'launch_minecraft') { window.portalTest.activeInstance = args.instanceId; window.portalTest.running = true; window.portalTest.emit('minecraft-process-state', true); return null; }
      if (command === 'get_minecraft_process_running') return window.portalTest.running;
      if (command === 'get_minecraft_launch_status') return { active: false, instanceId: window.portalTest.activeInstance, progress: 0, state: window.portalTest.running ? 'running' : 'idle', message: '' };
      if (command === 'get_saved_minecraft_profile') return localStorage.getItem('portal-test-signed-out') ? null : { id: 'profile', name: 'Test' };
      if (command === 'list_minecraft_accounts') return { activeId: null, accounts: [] };
      if (command === 'request_microsoft_device_code') throw 'Sign-in is offline in this fixture.';
      if (command === 'cosmetics_request') return { items: [] };
      if (command === 'get_content_download_queue') return { revision: 0, tasks: [] };
      if (command === 'plugin:event|listen') { listeners.set(args.event, [...(listeners.get(args.event) || []), args.handler]); return next++; }
      if (command === 'plugin:app|version') return '1.1.8';
      if (command === 'plugin:window|is_maximized') return false;
      if (command === 'get_minecraft_releases') return [{ id: '26.3', type: 'release' },{ id:'1.21.4',type:'release' }];
      if (['list_instance_content', 'list_pack_channel_memberships', 'reconcile_cosmetics', 'list_cached_screenshots', 'detect_java_installations', 'list_instance_folders', 'list_managed_java_runtimes'].includes(command)) return [];
      return null;
    }
  };
});
await mkdir('logs/portal', { recursive: true });
const shot = name => page.screenshot({ path: `logs/portal/${name}.png`, fullPage: true });
const nav = () => page.getByRole('navigation', { name: 'Main navigation' });
const rows = () => page.locator('.portal-place');
const openPortal = async () => { await nav().getByRole('button',{name:'Portal',exact:true}).click(); await page.waitForSelector('.portal-place, .portal-empty'); };
const calls = command => page.evaluate(command => window.portalTest.calls.filter(call => call.command === command), command);
try {
  await page.goto(url); await openPortal();
  const portalNav = page.getByRole('navigation',{name:'Portal destinations'});
  assert.deepEqual(await portalNav.getByRole('button').allTextContents(), ['All','Servers','Worlds']);
  assert.equal(await page.getByRole('button',{name:'Add server',exact:true}).evaluate(el=>getComputedStyle(el).backgroundImage),'none');
  assert.equal(await nav().getByRole('button', { name: 'Settings', exact: true }).count(), 1);
  assert.equal(await rows().count(), 3); assert.equal(await page.locator('.portal-resume, .portal-place-grid').count(), 0); await shot('dark');
  assert.deepEqual(await page.locator('.portal-group-title').allTextContents(), ['Servers', 'Worlds']);
  await page.waitForFunction(() => { const image = document.querySelector('.portal-server-fallback'); return image?.complete && image.naturalWidth === 128; });
  assert.equal(await page.getByRole('region', { name: 'Servers', exact: true }).locator('.portal-place').count(), 1);
  assert.equal(await page.locator('.portal-kind-group[aria-label="Worlds"]').locator('.portal-place').count(), 2);
  await page.getByRole('button', { name: 'Add server', exact: true }).hover();
  assert.notEqual(await page.getByRole('button', { name: 'Add server', exact: true }).evaluate(element => getComputedStyle(element).backgroundColor), 'rgba(0, 0, 0, 0)');
  const rowBounds = await rows().evaluateAll(elements => elements.map(element => { const rect = element.getBoundingClientRect(); return { x: rect.x, top: rect.top, bottom: rect.bottom, width: rect.width }; }));
  assert.ok(rowBounds.every(row => row.width === rowBounds[0].width && row.x === rowBounds[0].x));
  assert.ok(rowBounds[1].top >= rowBounds[0].bottom && rowBounds[2].top >= rowBounds[1].bottom);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  assert.equal(await page.locator('.portal-star svg').first().evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.getByRole('navigation',{name:'Portal destinations'}).getByRole('button', { name: 'Worlds', exact: true }).click(); assert.equal(await rows().count(), 2);
  assert.equal(await page.locator('.portal-group-title').count(), 0);
  await page.getByRole('button', { name: 'Servers', exact: true }).click(); assert.equal(await rows().count(), 1);
  await page.getByRole('button', { name: 'All', exact: true }).click();
  await page.getByRole('textbox', { name: 'Search Portal' }).fill('SMP'); assert.equal(await rows().count(), 1);
  await page.getByRole('button', { name: 'Clear Portal search' }).click();
  await page.getByRole('button', { name: 'Filter', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Instance', exact: true }).click();
  await page.getByRole('menu').getByRole('menuitemradio', { name: 'SMP · 26.3', exact: true }).click();
  assert.equal(await rows().count(), 1);
  assert.match(await rows().first().innerText(), /Friends/);
  await page.getByRole('button',{name:'Filter',exact:true}).click(); await page.getByRole('menuitem', { name: 'Reset', exact: true }).click(); await page.getByRole('button',{name:'Filter',exact:true}).click();
  await page.getByRole('menuitem', { name: 'Sort by', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Name', exact: true }).click();
  await page.getByRole('button',{name:'Filter',exact:true}).click();
  assert.equal(await rows().first().getAttribute('data-place-id'), 'server');
  assert.equal(await page.locator('.portal-kind-group[aria-label="Worlds"]').locator('.portal-place').first().getAttribute('data-place-id'), 'future');
  await page.getByRole('menuitem', { name: 'Sort by', exact: true }).click();
  await page.getByRole('menuitemradio', { name: 'Recently played', exact: true }).click();
  assert.equal(await page.locator('.portal-kind-group[aria-label="Worlds"]').locator('.portal-place').first().getAttribute('data-place-id'), 'world');
  await page.keyboard.press('Escape');
  assert.equal(await page.getByRole('button', { name: 'Filter', exact: true }).getAttribute('aria-expanded'), 'false');
  await rows().filter({ hasText: 'Friends' }).getByRole('button', { name: 'Options for Friends' }).click();
  const copyAction = page.getByRole('menuitem', { name: 'Copy address', exact: true });
  const iconGap = await copyAction.evaluate(el => {
    const label = document.createRange();
    label.selectNodeContents(el.lastChild);
    return label.getBoundingClientRect().left - el.querySelector('svg').getBoundingClientRect().right;
  });
  assert.ok(iconGap > 0 && iconGap <= 14);
  await copyAction.click();
  await page.getByRole('status').filter({ hasText: 'Address copied for Friends.' }).waitFor();
  assert.deepEqual((await calls('copy_text_to_clipboard')).at(-1).args, { text: 'play.example.com:25566' });
  await page.getByRole('button', { name: 'Dismiss Portal notification' }).click();
  await page.evaluate(() => window.portalTest.failCopy = true);
  await rows().filter({ hasText: 'Friends' }).getByRole('button', { name: 'Options for Friends' }).click();
  await page.getByRole('menuitem', { name: 'Copy address', exact: true }).click();
  await page.getByRole('alert').filter({ hasText: 'Clipboard is unavailable.' }).waitFor();
  assert.equal(await page.getByRole('status').filter({ hasText: 'Address copied' }).count(), 0);
  await page.evaluate(() => window.portalTest.failCopy = false);
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByRole('alert').waitFor({ state: 'hidden' });


  await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Favorite Survival World', exact: true }).click();
  await page.getByRole('button', { name: 'Favorites', exact: true }).click(); assert.equal(await rows().count(), 2);
  await page.reload(); await page.waitForSelector('.portal-place'); assert.equal(await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Unfavorite Survival World' }).count(), 1);
  assert.equal(await rows().filter({ hasText: 'Future world' }).getByRole('button', { name: 'Play Future world' }).isDisabled(), true);
  // The attached form keeps its fields on failure; Escape closes the picker first.
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  const dialog = page.getByRole('form', { name: 'Add a server' });
  assert.equal(await page.getByRole('button', { name: 'Back to list' }).getAttribute('aria-expanded'), 'true');
  await dialog.getByLabel('Name', { exact: true }).fill('New place'); await dialog.getByLabel('Server address').fill('friends.example.com');
  await dialog.getByLabel('Name', { exact: true }).press('Escape'); await dialog.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  assert.equal(await dialog.getByLabel('Name', { exact: true }).inputValue(), 'New place');
  await dialog.getByRole('button', { name: 'Server instance' }).click(); await page.keyboard.press('Escape'); assert.equal(await dialog.isVisible(), true);
  await dialog.getByRole('button', { name: 'Server instance' }).click(); await page.locator('.select-menu-portal').getByRole('button', { name: 'SMP · 26.3', exact: true }).click();
  await page.evaluate(() => window.portalTest.failSave = true); await dialog.getByRole('button', { name: 'Save server', exact: true }).click();
  await dialog.getByRole('alert').waitFor(); assert.match(await dialog.getByRole('alert').innerText(), /Could not save/);
  await page.evaluate(() => window.portalTest.failSave = false); await dialog.getByRole('button', { name: 'Save server', exact: true }).click(); await dialog.waitFor({ state: 'hidden' });
  assert.deepEqual((await calls('change_portal')).at(-1).args.change, { action: 'addServer', instanceId: '1', name: 'New place', address: 'friends.example.com' });
  await rows().filter({ hasText: 'New place' }).getByRole('button', { name: 'Options for New place' }).click();
  await page.getByRole('menuitem', { name: 'Remove New place shortcut' }).click();
  await page.getByRole('group', { name: 'Remove New place shortcut' }).getByRole('button', { name: 'Keep' }).click(); assert.equal(await rows().count(), 4);
  await rows().filter({ hasText: 'New place' }).getByRole('button', { name: 'Options for New place' }).click();
  await page.getByRole('menuitem', { name: 'Remove New place shortcut' }).click();
  await page.getByRole('group', { name: 'Remove New place shortcut' }).getByRole('button', { name: 'Remove', exact: true }).click(); await page.waitForFunction(() => document.querySelectorAll('.portal-place').length === 3);
  // An older read must not roll back a saved favorite.
  await page.evaluate(() => { window.portalTest.delayRead = true; window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => window.portalTest.releaseRead);
  await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Unfavorite Survival World' }).click();
  await page.evaluate(() => { window.portalTest.delayRead = false; window.portalTest.releaseRead(); });
  await page.waitForTimeout(100); assert.equal(await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Favorite Survival World' }).count(), 1);
  await rows().filter({ hasText: 'Friends' }).getByRole('button', { name: 'Join Friends', exact: true }).click();
  assert.deepEqual((await calls('launch_minecraft')).at(-1).args.portalTarget, { kind: 'server', target: 'play.example.com:25566' });
  assert.equal((await calls('launch_minecraft')).at(-1).args.instanceId, '1');
  assert.equal(await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Play Survival World' }).isDisabled(), true);
  await page.evaluate(() => { window.portalTest.running = false; window.portalTest.emit('minecraft-process-state', false); window.dispatchEvent(new Event('focus')); });
  await page.waitForFunction(() => !document.querySelector('.portal-place [aria-label="Play Survival World"]').disabled);
  await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Play Survival World' }).click();
  assert.deepEqual((await calls('launch_minecraft')).at(-1).args.portalTarget, { kind: 'world', target: 'Survival World' });
  assert.equal((await calls('launch_minecraft')).at(-1).args.instanceId, '0');
  await page.reload(); await page.waitForSelector('.portal-place');
  // Account settings remains accessible, including compact and signed-out accounts.
  await page.locator('.rail-account-trigger').click(); await page.getByRole('menuitem', { name: 'Account settings', exact: true }).click(); await page.waitForSelector('.settings-layout');
  await openPortal(); await rows().filter({ hasText: 'Survival World' }).getByRole('button', { name: 'Options for Survival World' }).click();
  await page.getByRole('menuitem', { name: 'Open instance', exact: true }).click();
  await page.waitForSelector('.instance-hero-panel'); assert.equal(await page.locator('.instance-hero-panel').getByRole('tab', { name: 'Mods', exact: true }).count(), 1);
  await page.locator('.instance-play').click(); assert.equal('portalTarget' in (await calls('launch_minecraft')).at(-1).args, false);
  await page.evaluate(() => { localStorage.setItem('portal-test-prefs', JSON.stringify({ theme: 'light', animations: false })); localStorage.setItem('bloom-last-page', 'portal'); });
  await page.setViewportSize({ width: 900, height: 740 }); await page.reload(); await page.waitForSelector('.portal-place'); await shot('light-compact');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.getByRole('button', { name: 'Add server', exact: true }).click();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.equal(await page.locator('#portal-add-panel').evaluate(element => getComputedStyle(element).transitionDuration), '0s');
  await page.getByRole('button', { name: 'Back to list', exact: true }).click();
  await page.evaluate(() => localStorage.setItem('portal-test-signed-out', 'true')); await page.reload(); await page.getByRole('button',{name:'Sign in',exact:true}).waitFor();
  await page.getByRole('button',{name:'Sign in',exact:true}).click(); const signedOutSettings = page.getByRole('menuitem', { name: 'Client settings', exact: true }); await signedOutSettings.click(); await page.waitForSelector('.settings-layout');
  await openPortal(); await page.evaluate(() => window.portalTest.failRead = true); await page.getByRole('button', { name: 'Refresh Portal' }).click(); await page.getByRole('alert').waitFor();
  await page.evaluate(() => window.portalTest.failRead = false); await page.getByRole('button', { name: 'Retry', exact: true }).click(); await page.getByRole('alert').waitFor({ state: 'hidden' });
  await page.evaluate(() => { window.portalTest.entries = []; window.portalTest.emit('portal-changed', null); }); await page.getByRole('heading', { name: 'Nothing here yet' }).waitFor(); await shot('empty');

  await page.evaluate(() => { localStorage.setItem('portal-test-fail-read', 'true'); localStorage.setItem('bloom-last-page', 'portal'); });
  await page.reload();
  await page.getByRole('heading', { name: 'Couldn’t load Portal' }).waitFor();
  assert.equal(await page.getByRole('heading', { name: 'Nothing here yet' }).count(), 0);
  await page.evaluate(() => { localStorage.removeItem('portal-test-fail-read'); window.portalTest.failRead = false; });
  await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.waitForSelector('.portal-place');
  assert.equal(await rows().count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Local servers', exact: true }).count(), 0);
  assert.deepEqual(errors, []);
  console.log('Portal UI passed: simple server-list rows, instance filters, sorting, clipboard success/failure, initial-read recovery, navigation, persistence, dedicated add form, instance picker, save errors, delete confirmation, stale reads, correct direct launch payloads, busy guard, normal Play preservation, signed-out Settings, compact Light layout and empty/retry states.');
} catch (error) { console.log('Browser errors:', errors); await shot('failure'); throw error; } finally { await browser.close(); }
