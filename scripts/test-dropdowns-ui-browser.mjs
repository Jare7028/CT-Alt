// Exercise real directory and shell menus using synthetic users, with no backend.
import assert from 'node:assert/strict';
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright-core';

const root = new URL('../', import.meta.url);
const route = new URL('../app/dropdown-review/', import.meta.url);
const baseURL = 'http://127.0.0.1:5182';
let server, browser, log = '';
await mkdir(route, { recursive: false });
try {
  await copyFile(new URL('../tests/fixtures/controls-review-page.tsx', import.meta.url), new URL('page.tsx', route));
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '5182'], {
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_SUPABASE_URL: 'http://disabled.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'disabled', NEXT_TELEMETRY_DISABLED: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout.on('data', chunk => { log += chunk; });
  server.stderr.on('data', chunk => { log += chunk; });
  for (let attempt = 0; attempt < 90; attempt++) {
    try { if ((await fetch(`${baseURL}/dropdown-review`)).ok) break; } catch {}
    if (attempt === 89 || server.exitCode !== null) throw Error(`Review server failed: ${log}`);
    await delay(500);
  }
  browser = await chromium.launch({ executablePath: process.env.CT_ALT_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] });
  for (const mobile of [false, true]) {
    const context = await browser.newContext({ viewport: mobile ? { width: 390, height: 844 } : { width: 1444, height: 960 }, hasTouch: mobile });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', request => new URL(request.request().url()).hostname === '127.0.0.1' ? request.continue() : request.abort());
    await page.goto(`${baseURL}/dropdown-review`);
    await page.getByRole('heading', { name: 'Users', exact: true }).waitFor();
    const activate = async locator => mobile ? locator.tap() : locator.click();
    const filter = page.locator('.directory-filter');
    const panel = page.getByRole('region', { name: 'User filters' });
    const trigger = page.getByLabel('Filter users', { exact: true });
    const isOpen = locator => locator.evaluate(element => element.open);
    const outside = page.getByRole('heading', { name: 'Users', exact: true });
    await activate(trigger);
    await panel.waitFor({ state: 'visible' });
    await activate(panel.getByRole('button', { name: '+ Add filter', exact: true }));
    await panel.getByLabel('Value filter 1', { exact: true }).selectOption('North');
    assert.equal(await isOpen(filter), true, 'Selecting a filter keeps its panel open');
    assert.match(await page.locator('.pagination').textContent(), /of 186/);
    // Outside event handlers must not be able to swallow dismissal.
    await outside.evaluate(element => element.addEventListener('pointerdown', event => event.stopPropagation()));
    await activate(outside);
    assert.equal(await isOpen(filter), false, 'Outside mouse/touch collapses filters');
    await activate(trigger);
    assert.equal(await panel.getByLabel('Value filter 1', { exact: true }).inputValue(), 'North', 'Dismissal preserves selected filters');
    // Keyboard / assistive activation can dispatch click without pointerdown.
    await outside.evaluate(element => element.click());
    assert.equal(await isOpen(filter), false, 'Click-only outside activation collapses filters');
    await activate(trigger);
    await panel.getByRole('button', { name: 'Advanced filters', exact: true }).focus();
    await page.keyboard.press('Escape');
    assert.equal(await isOpen(filter), false, 'Escape collapses filters');
    assert.equal(await trigger.evaluate(element => element === document.activeElement), true, 'Escape restores trigger focus');
    await activate(trigger);
    const download = page.waitForEvent('download');
    await activate(page.getByRole('button', { name: 'Export all matching users' }));
    await download;
    assert.equal(await isOpen(filter), false, 'Outside action still runs while dismissing');
    await activate(trigger);
    await activate(page.getByLabel('Account menu'));
    assert.equal(await isOpen(filter), false, 'Opening another dropdown closes the previous one');
    await activate(outside);
    await page.getByLabel('Choose columns').scrollIntoViewIfNeeded();
    await activate(page.getByLabel('Choose columns'));
    const columns = page.locator('.column-picker');
    const title = columns.getByLabel('Title', { exact: true });
    await title.uncheck();
    assert.equal(await isOpen(columns), true, 'Column changes keep their panel open');
    await activate(outside);
    assert.equal(await isOpen(columns), false, 'Column picker dismisses outside');
    const add = page.locator('.add-menu');
    await activate(add.locator('summary'));
    await activate(outside);
    assert.equal(await isOpen(add), false, 'Add menu dismisses outside');
    await activate(add.locator('summary'));
    await activate(add.getByRole('button', { name: 'Add manually', exact: true }));
    await page.getByRole('dialog').waitFor({ state: 'visible' });
    assert.equal(await isOpen(add), false, 'Menu action still opens its dialog');
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await activate(page.getByLabel('Account menu'));
    await activate(outside);
    assert.equal(await isOpen(page.locator('.ct-account')), false, 'Account menu dismisses outside');
    if (!mobile) {
      const quickNav = page.locator('.ct-quick-nav');
      await activate(quickNav.locator('summary'));
      await activate(page.locator('.pagination'));
      assert.equal(await isOpen(quickNav), false, 'Module menu dismisses outside');
      assert.equal(await isOpen(page.locator('.ct-sidebar .ct-nav-group').first()), true, 'Sidebar sections remain expanded');
    }
    assert.deepEqual(errors, [], 'No browser runtime errors');
    console.log(`${mobile ? 'Touch/mobile' : 'Mouse/desktop'}: outside dismissal, internal controls, saved filters, Escape, menu switching and actions passed`);
    await context.close();
  }
} finally {
  await browser?.close();
  if (server && server.exitCode === null) {
    const stopped = new Promise(resolve => server.once('exit', resolve));
    server.kill('SIGTERM');
    await stopped;
  }
  await rm(route, { recursive: true, force: true });
}
