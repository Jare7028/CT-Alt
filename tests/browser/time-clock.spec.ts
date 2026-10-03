import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { TimeClockChange, TimeClockData, TimeClockEntriesData, TimeClockSaved } from '../../lib/time-clock-types';

const fixture = JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json', 'utf8'));
const db = 'supabase_db_ct-alt-independent';
const origin = 'http://127.0.0.1:5180';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (fixture.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(fixture.fixtureLabel) ||
  ![fixture.tenantA, fixture.tenantB, ...Object.values(fixture.accounts).map(account => (account as {id:string}).id)].every(value => uuid.test(value))) throw Error('Owned local fixture required');
test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);
test.use({ viewport: { width: 1444, height: 960 } });
type Operation = { tenantId: string; operationId: string; change: TimeClockChange };
let supportJob: string;
let employeeClock: Operation;
let employeeReceipt: TimeClockSaved;
let employeeAgent: string;
let retainedRows: string;
let baseWorkforce: string;
const runtimeErrors = new WeakMap<Page, string[]>();
const retainedJob = '61000000-0000-4000-8000-000000000001';
const replacementAgent = '61000000-0000-4000-8000-000000000002';
function sql(query: string) {
  const label = spawnSync('docker', ['inspect', db, '--format', '{{index .Config.Labels "ct-alt.test"}}'], { encoding: 'utf8' });
  if (label.status !== 0 || label.stdout.trim() !== fixture.fixtureLabel) throw Error('Wrong fixture database');
  const result = spawnSync('docker', ['exec', '-i', db, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: query, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr);
  return result.stdout.trim();
}
const workforceSnapshot = `select jsonb_build_object(
 'tenants',(select jsonb_agg(to_jsonb(t) order by id) from public.tenants t),
 'memberships',(select jsonb_agg(to_jsonb(m) order by tenant_id,user_id) from public.tenant_memberships m),
 'agents',(select jsonb_agg(to_jsonb(a) order by id) from public.agents a),
 'fields',(select jsonb_agg(to_jsonb(f) order by tenant_id,key) from public.agent_fields f));`;
const retainedSnapshot = `select jsonb_build_object(
 'job',(select to_jsonb(j) from public.time_clock_jobs j where id='${retainedJob}'),
 'entries',(select jsonb_agg(to_jsonb(e) order by id) from public.time_clock_entries e where job_id='${retainedJob}'));
`;
async function login(page: Page, account = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.accounts[account].email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.accounts[account].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/agents/);
}
const url = (mode = 'status', tenantId = fixture.tenantA) => `/api/time-clock?${new URLSearchParams({ tenantId, mode })}`;
const operation = (change: TimeClockChange, tenantId = fixture.tenantA): Operation => ({ tenantId, operationId: randomUUID(), change });
const post = (request: APIRequestContext, payload: Operation) => request.post('/api/time-clock', { headers: { Origin: origin }, data: payload });
async function status(request: APIRequestContext, tenantId = fixture.tenantA): Promise<TimeClockData> {
  const response = await request.get(url('status', tenantId)); expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store'); return response.json();
}
async function entries(request: APIRequestContext, mode = 'timesheets'): Promise<TimeClockEntriesData> {
  const response = await request.get(url(mode)); expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store'); return response.json();
}
async function save(request: APIRequestContext, payload: Operation): Promise<TimeClockSaved> {
  const response = await post(request, payload); expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store'); const { saved } = await response.json();
  expect(saved.operationId).toBe(payload.operationId); expect(saved.action).toBe(payload.change.action); return saved;
}
async function clockPage(page: Page) {
  await page.goto(`/time-clock?company=${fixture.tenantA}`);
  await expect(page.getByRole('heading', { name: 'Time Clock', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh clock status', exact: true })).toBeEnabled();
}
async function clickSave(page: Page, name: string) {
  const response = page.waitForResponse(value => new URL(value.url()).pathname === '/api/time-clock' && value.request().method() === 'POST');
  await page.getByRole('button', { name, exact: true }).click();
  const saved = await response; expect(saved.status()).toBe(200);
  await expect(page.getByRole('button', { name: 'Refresh clock status', exact: true })).toBeEnabled();
  return { payload: saved.request().postDataJSON() as Operation, saved: (await saved.json()).saved as TimeClockSaved };
}
test.beforeAll(() => {
  employeeAgent = sql(`select id from public.agents where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';`);
  expect(uuid.test(employeeAgent)).toBe(true);
  sql(`insert into public.time_clock_jobs(id,tenant_id,name) values('${retainedJob}','${fixture.tenantA}','Synthetic retained work');
    insert into public.time_clock_entries(tenant_id,agent_id,job_id,agent_name,job_name,started_at,ended_at)
    select '${fixture.tenantA}',id,'${retainedJob}',first_name||' '||last_name,'Synthetic retained work',statement_timestamp()-interval '3 days',statement_timestamp()-interval '3 days'+interval '1 hour'
    from public.agents where tenant_id='${fixture.tenantA}' and user_id in ('${fixture.accounts.employee.id}','${fixture.accounts.owner.id}');
    insert into public.agents(id,tenant_id,first_name,last_name,phone,created_by) values('${replacementAgent}','${fixture.tenantA}','Synthetic','replacement','+447700901299','${fixture.accounts.owner.id}');`);
  retainedRows = sql(retainedSnapshot); baseWorkforce = sql(workforceSnapshot);
});
test.afterAll(() => {
  expect(sql(retainedSnapshot)).toBe(retainedRows);
  expect(sql(workforceSnapshot)).toBe(baseWorkforce);
});
test.beforeEach(({ page }) => {
  const errors: string[] = []; runtimeErrors.set(page, errors);
  page.on('pageerror', error => errors.push(error.message));
});
test.afterEach(({ page }) => { expect(runtimeErrors.get(page)).toEqual([]); });

test('real signed users enforce role and tenant boundaries; owner creates a desktop job', async ({ page, browser }) => {
  expect((await page.request.get(url())).status()).toBe(401);
  expect((await post(page.request, operation({ action: 'create_job', name: 'Unsigned work' }))).status()).toBe(401);
  await login(page); await clockPage(page);
  await expect(page.locator('.ct-sidebar a[aria-current="page"]')).toHaveText('Time Clock');
  await page.getByRole('tab', { name: 'Jobs', exact: true }).click();
  await page.getByLabel('Job name', { exact: true }).fill('Synthetic acceptance support');
  const created = await clickSave(page, 'Create job'); supportJob = created.saved.jobId;
  expect(created.payload.change).toEqual({ action: 'create_job', name: 'Synthetic acceptance support' });
  await expect(page.getByRole('button', { name: 'Archive Synthetic acceptance support', exact: true })).toBeVisible();
  expect((await page.request.post('/api/time-clock', { headers: { Origin: 'https://foreign.invalid' }, data: created.payload })).status()).toBe(403);
  expect((await post(page.request, { ...operation({ action: 'clock_in', jobId: supportJob }), change: { action: 'clock_in', jobId: supportJob, started_at: '2026-01-01T00:00:00Z' } } as unknown as Operation)).status()).toBe(400);
  for (const account of ['admin', 'manager', 'employee', 'foreign']) {
    const context = await browser.newContext({ viewport: { width: 1444, height: 960 } }); const other = await context.newPage();
    try {
      await login(other, account);
      if (account === 'foreign') {
        expect((await other.request.get(url())).status()).toBe(403);
        expect((await post(other.request, operation({ action: 'clock_in', jobId: supportJob }))).status()).toBe(403);
        expect((await status(other.request, fixture.tenantB)).company.id).toBe(fixture.tenantB); continue;
      }
      const current = await status(other.request); expect(current.role).toBe(account);
      expect(current.actorId).toBe(fixture.accounts[account].id); expect(current.agent).not.toBeNull();
      expect(current.canManageJobs).toBe(account === 'admin'); expect(current.canViewAttendance).toBe(account === 'admin');
      expect((await other.request.get(url('attendance'))).status()).toBe(account === 'admin' ? 200 : 403);
      if (account !== 'admin') {
        expect((await post(other.request, operation({ action: 'create_job', name: 'Unauthorized job' }))).status()).toBe(403);
        expect((await post(other.request, operation({ action: 'archive_job', jobId: supportJob, revision: 1 }))).status()).toBe(403);
      }
      if (account === 'manager' || account === 'admin') {
        const started = await save(other.request, operation({ action: 'clock_in', jobId: supportJob }));
        expect((await status(other.request)).entry?.agent_id).toBe(current.agent!.id);
        await save(other.request, operation({ action: 'clock_out', entryId: started.entryId!, revision: started.revision }));
        expect((await entries(other.request)).entries.every(entry => entry.agent_id === current.agent!.id)).toBe(true);
      }
    } finally { await context.close(); }
  }
  const currentOwner = await status(page.request); expect(currentOwner.role).toBe('owner');
  expect(currentOwner.canManageJobs).toBe(true); expect(currentOwner.canViewAttendance).toBe(true);
  const ownerStarted = await save(page.request, operation({ action: 'clock_in', jobId: supportJob }));
  expect((await status(page.request)).entry?.agent_id).toBe(currentOwner.agent!.id);
  await save(page.request, operation({ action: 'clock_out', entryId: ownerStarted.entryId!, revision: ownerStarted.revision }));
  expect((await page.request.get(url('status', fixture.tenantB))).status()).toBe(403);
  await page.screenshot({ path: 'test-results/time-clock-live-desktop-jobs.png', fullPage: true });
});

test('linked employee clocks in, takes unpaid and paid breaks, and receives only own completed history', async ({ page }) => {
  await login(page, 'employee'); await clockPage(page);
  await expect(page.getByRole('tab', { name: 'Today', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Jobs', exact: true })).toHaveCount(0);
  await page.getByLabel('Select a job', { exact: true }).selectOption(supportJob);
  const started = await clickSave(page, 'Clock in'); employeeClock = started.payload; employeeReceipt = started.saved;
  expect(employeeClock.change).toEqual({ action: 'clock_in', jobId: supportJob });
  expect(await save(page.request, employeeClock)).toEqual(employeeReceipt);
  expect(sql(`select count(*) from public.time_clock_audit where operation_id='${employeeClock.operationId}';`)).toBe('1');
  expect((await post(page.request, operation({ action: 'clock_in', jobId: supportJob }))).status()).toBe(409);
  await expect(page.getByRole('button', { name: 'Start break', exact: true })).toBeEnabled();
  await clickSave(page, 'Start break'); await expect(page.locator('.clock-state')).toHaveText('On unpaid break');
  const paused = await page.getByLabel('Tracked work time', { exact: true }).textContent();
  await expect.poll(async () => (await status(page.request)).entry!.unpaid_break_seconds).toBeGreaterThan(1);
  await expect(page.getByLabel('Tracked work time', { exact: true })).toHaveText(paused!);
  await clickSave(page, 'End break');
  await page.getByLabel('Break type', { exact: true }).selectOption('paid');
  await clickSave(page, 'Start break'); await expect(page.locator('.clock-state')).toHaveText('On paid break');
  const paid = await page.getByLabel('Tracked work time', { exact: true }).textContent();
  await expect.poll(() => page.getByLabel('Tracked work time', { exact: true }).textContent()).not.toBe(paid);
  await clickSave(page, 'Clock out'); await expect(page.locator('.clock-state')).toHaveText('Clocked out');
  const history = await entries(page.request); const completed = history.entries.find(entry => entry.id === employeeReceipt.entryId)!;
  expect(completed).toBeDefined(); expect(completed.revision).toBe(5); expect(completed.breaks.map(pause => pause.paid)).toEqual([false, true]);
  expect(completed.breaks.every(pause => pause.ended_at)).toBe(true);
  expect(completed.breaks[1].ended_at).toBe(completed.ended_at);
  expect(completed.unpaid_break_seconds).toBeGreaterThan(1);
  expect(completed.paid_seconds).toBeCloseTo(completed.elapsed_seconds - completed.unpaid_break_seconds, 5);
  expect(history.entries.every(entry => entry.agent_id === employeeAgent && entry.tenant_id === fixture.tenantA)).toBe(true);
  expect(history.entries.some(entry => entry.job_id === retainedJob)).toBe(true);
  await expect(page.locator('.clock-timesheets tbody')).toContainText('Synthetic acceptance support');
  await page.screenshot({ path: 'test-results/time-clock-live-desktop-timesheets.png', fullPage: true });
});

test('Today shows the retained employee name and archived jobs permit finishing an existing shift', async ({ page, browser }) => {
  await login(page, 'owner'); await clockPage(page);
  const created = await save(page.request, operation({ action: 'create_job', name: 'Synthetic archive continuity' }));
  const context = await browser.newContext({ viewport: { width: 1444, height: 960 } }); const employee = await context.newPage();
  try {
    await login(employee, 'employee'); await clockPage(employee);
    await employee.getByLabel('Select a job', { exact: true }).selectOption(created.jobId);
    const started = await clickSave(employee, 'Clock in');
    await page.getByRole('tab', { name: 'Today', exact: true }).click();
    const row = page.locator('.clock-table tbody tr').filter({ hasText: 'Synthetic archive continuity' });
    await expect(row).toContainText('Clocked in');
    await expect(row.getByRole('link', { name: 'Synthetic employee', exact: true })).toHaveAttribute('href', `/agents/${employeeAgent}?company=${fixture.tenantA}`);
    await page.screenshot({ path: 'test-results/time-clock-live-desktop-today.png', fullPage: true });
    await page.getByRole('button', { name: 'Refresh clock status', exact: true }).click();
    await page.getByRole('tab', { name: 'Jobs', exact: true }).click();
    await page.getByRole('button', { name: 'Archive Synthetic archive continuity', exact: true }).click();
    const archived = page.waitForResponse(response => new URL(response.url()).pathname === '/api/time-clock' && response.request().method() === 'POST');
    await page.getByRole('dialog').getByRole('button', { name: 'Archive job', exact: true }).click(); expect((await archived).status()).toBe(200);
    await employee.getByRole('button', { name: 'Refresh clock status', exact: true }).click();
    await expect(employee.getByRole('button', { name: 'Start break', exact: true })).toBeEnabled();
    expect((await status(employee.request)).jobs.find(job => job.id === created.jobId)?.status).toBe('archived');
    await clickSave(employee, 'Start break'); await clickSave(employee, 'End break'); await clickSave(employee, 'Clock out');
    expect((await entries(employee.request)).entries.find(entry => entry.id === started.saved.entryId)?.job_name).toBe('Synthetic archive continuity');
    expect((await post(employee.request, operation({ action: 'clock_in', jobId: created.jobId }))).status()).toBe(409);
    await page.getByRole('tab', { name: 'Today', exact: true }).click(); await expect(row).toContainText('Clocked out');
    expect((await entries(page.request, 'attendance')).entries.some(entry => entry.id === started.saved.entryId)).toBe(true);
    expect((await entries(page.request)).entries.some(entry => entry.agent_id === employeeAgent)).toBe(false);
  } finally { await context.close(); }
});

test('current revocation and relinking deny old receipts with existing signed cookies and retain recorded history', async ({ page }) => {
  await login(page, 'employee'); await clockPage(page);
  try {
    sql(`update public.tenant_memberships set status='suspended' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';`);
    expect((await page.request.get(url())).status()).toBe(403); expect((await post(page.request, employeeClock)).status()).toBe(403);
    await page.getByRole('button', { name: 'Refresh clock status', exact: true }).click();
    await expect(page.locator('.clock-recovery')).toBeVisible(); await expect(page.locator('.clock-table tbody tr')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Clock in', exact: true })).toHaveCount(0);
  } finally { sql(`update public.tenant_memberships set status='active' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';`); }
  await page.getByRole('button', { name: 'Refresh to recover', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Clock in', exact: true })).toBeVisible();
  try {
    sql(`update public.agents set status='archived' where id='${employeeAgent}';`);
    expect((await status(page.request)).agent).toBeNull(); expect((await post(page.request, employeeClock)).status()).toBe(403);
  } finally { sql(`update public.agents set status='active' where id='${employeeAgent}';`); }
  try {
    sql(`begin;update public.agents set user_id=null where id='${employeeAgent}';update public.agents set user_id='${fixture.accounts.employee.id}' where id='${replacementAgent}';commit;`);
    expect((await status(page.request)).agent?.id).toBe(replacementAgent);
    expect((await entries(page.request)).entries).toEqual([]);
    expect((await post(page.request, employeeClock)).status()).toBe(403);
    await page.getByRole('button', { name: 'Refresh clock status', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Synthetic replacement’s clock', exact: true })).toBeVisible();
    await expect(page.locator('.clock-timesheets tbody tr')).toHaveCount(0);
    expect(sql(retainedSnapshot)).toBe(retainedRows);
  } finally { sql(`begin;update public.agents set user_id=null where id='${replacementAgent}';update public.agents set user_id='${fixture.accounts.employee.id}' where id='${employeeAgent}';commit;`); }
  expect(await save(page.request, employeeClock)).toEqual(employeeReceipt);
  expect(sql(`select count(*) from public.time_clock_audit where operation_id='${employeeClock.operationId}';`)).toBe('1');
});

test('revoked admin capabilities cannot replay a job receipt or restore Today rows', async ({ page }) => {
  await login(page, 'admin'); await clockPage(page);
  const created = operation({ action: 'create_job', name: 'Synthetic revoked-role receipt' }); const receipt = await save(page.request, created);
  await page.getByRole('tab', { name: 'Today', exact: true }).click(); await expect(page.locator('.clock-table tbody tr').first()).toBeVisible();
  try {
    sql(`update public.tenant_memberships set role='manager' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`);
    expect((await post(page.request, created)).status()).toBe(403);
    expect((await page.request.get(url('attendance'))).status()).toBe(403);
    await page.getByRole('button', { name: 'Refresh attendance', exact: true }).click(); await expect(page.locator('.clock-recovery')).toBeVisible();
    await expect(page.locator('.clock-table tbody tr')).toHaveCount(0); await expect(page.getByRole('tab', { name: 'Today', exact: true })).toHaveCount(0);
    await expect(page.getByRole('tab', { name: 'Jobs', exact: true })).toHaveCount(0);
  } finally { sql(`update public.tenant_memberships set role='admin' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`); }
  expect(await save(page.request, created)).toEqual(receipt);
  expect(sql(`select count(*) from public.time_clock_audit where operation_id='${created.operationId}';`)).toBe('1');
});

test('committed lost acknowledgement stays locked through a failed read and retries exactly once', async ({ page }) => {
  await login(page, 'employee'); await clockPage(page);
  await page.getByLabel('Select a job', { exact: true }).selectOption(supportJob);
  let lost: Operation | undefined; let committed: TimeClockSaved | undefined;
  const bodies: Operation[] = [];
  await page.route('**/api/time-clock', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const payload = route.request().postDataJSON() as Operation; bodies.push(payload);
    if (!lost) {
      lost = payload; const response = await route.fetch(); expect(response.status()).toBe(200);
      committed = (await response.json()).saved; return route.abort('failed');
    }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Clock in', exact: true }).click(); await expect(page.locator('.clock-recovery')).toBeVisible();
  expect(committed?.entryId).toBeDefined();
  expect((await status(page.request)).entry?.id).toBe(committed!.entryId);
  const storageKey = `ct-alt:time-clock:${fixture.accounts.employee.id}:${fixture.tenantA}`;
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), storageKey)).toEqual({ operationId: lost!.operationId, action: 'clock_in' });
  await page.route('**/api/time-clock?**', async route => {
    if (route.request().method() === 'GET') return route.fulfill({ status: 503, json: { error: 'Synthetic failed recovery read' } });
    return route.continue();
  });
  await page.getByRole('button', { name: 'Refresh to recover', exact: true }).click();
  await expect(page.locator('.clock-error')).toContainText('could not be refreshed'); await expect(page.locator('.clock-recovery')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Clock in', exact: true })).toHaveCount(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key) !== null, storageKey)).toBe(true);
  await page.screenshot({ path: 'test-results/time-clock-live-desktop-recovery.png', fullPage: true });
  await page.unroute('**/api/time-clock?**');
  await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Start break', exact: true })).toBeEnabled();
  expect(bodies).toEqual([lost, lost]);
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
  expect(sql(`select count(*) from public.time_clock_entries where id='${committed!.entryId}';`)).toBe('1');
  expect(sql(`select count(*) from public.time_clock_audit where operation_id='${lost!.operationId}';`)).toBe('1');
  await page.unroute('**/api/time-clock'); await clickSave(page, 'Clock out');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
