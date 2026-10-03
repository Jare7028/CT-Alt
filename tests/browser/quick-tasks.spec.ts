import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { QuickTask, QuickTaskChange, QuickTasksData, QuickTaskSaved } from '../../lib/quick-task-types';

const fixture = JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json', 'utf8'));
const origin = 'http://127.0.0.1:5180';
const db = 'supabase_db_ct-alt-independent';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if (fixture.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(fixture.fixtureLabel) || ![fixture.tenantA, fixture.tenantB, ...Object.values(fixture.accounts).map(a => (a as { id: string }).id)].every(id => uuid.test(id))) throw Error('Owned local fixture required');
test.describe.configure({ mode: 'serial' });
test.setTimeout(60_000);
test.use({ viewport: { width: 1444, height: 960 } });
function sql(query: string) {
  const inspected = spawnSync('docker', ['inspect', db, '--format', '{{index .Config.Labels "ct-alt.test"}}'], { encoding: 'utf8' });
  if (inspected.status !== 0 || inspected.stdout.trim() !== fixture.fixtureLabel) throw Error('Wrong fixture database');
  const result = spawnSync('docker', ['exec', '-i', db, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: query, encoding: 'utf8', timeout: 30_000 });
  if (result.error || result.status !== 0) throw Error(result.error?.message || result.stderr);
  return result.stdout.trim();
}
const path = (suffix = '') => `/api/quick-tasks?tenantId=${fixture.tenantA}${suffix}`;
const detailPath = (id: string) => `/api/quick-tasks/${id}?tenantId=${fixture.tenantA}`;
async function login(page: Page, account = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.accounts[account].email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.accounts[account].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/agents/);
}
type Operation = { tenantId: string; operationId: string; change: QuickTaskChange };
const operation = (change: QuickTaskChange): Operation => ({ tenantId: fixture.tenantA, operationId: randomUUID(), change });
async function send(request: APIRequestContext, body: Operation) {
  return request.post('/api/quick-tasks', { headers: { Origin: origin }, data: body });
}
async function save(request: APIRequestContext, body: Operation): Promise<QuickTaskSaved> {
  const response = await send(request, body); expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toContain('no-store'); return (await response.json()).saved;
}
async function data(request: APIRequestContext, suffix = ''): Promise<QuickTasksData> {
  const response = await request.get(path(suffix)); expect(response.status()).toBe(200); return response.json();
}
async function task(request: APIRequestContext, id: string): Promise<QuickTask> {
  const response = await request.get(detailPath(id)); expect(response.status()).toBe(200); return (await response.json()).task;
}
let employeeAgent: string, managerAgent: string, draftId: string, groupId: string, employeeTask: string, managerTask: string;
let completion: Operation;
let completionReceipt: QuickTaskSaved;
const replacement = '68000000-0000-4000-8000-000000000001';
let workforceBefore: string;
const workforceQuery = `select jsonb_build_object('tenants',(select jsonb_agg(to_jsonb(t) order by id) from public.tenants t),'memberships',(select jsonb_agg(to_jsonb(m) order by tenant_id,user_id) from public.tenant_memberships m),'agents',(select jsonb_agg(to_jsonb(a) order by id) from public.agents a),'fields',(select jsonb_agg(to_jsonb(f) order by tenant_id,key) from public.agent_fields f));`;
test.beforeAll(() => { workforceBefore = sql(workforceQuery); });

test('signed roles, tenant scope, draft privacy and explicit group/individual creation', async ({ page, browser }) => {
  expect((await page.request.get(path())).status()).toBe(401);
  await login(page); const initial = await data(page.request);
  employeeAgent = initial.assignableAgents.find(a => a.name === 'Synthetic employee')!.id;
  managerAgent = initial.assignableAgents.find(a => a.name === 'Synthetic manager')!.id;
  const common = { title: 'Synthetic shared check', description: 'Shared completion for both users', agentIds: [employeeAgent, managerAgent], startDate: null, dueDate: null };
  draftId = (await save(page.request, operation({ action: 'create', mode: 'group', publication: 'draft', ...common, title: 'Synthetic private draft' }))).tasks[0].id;
  groupId = (await save(page.request, operation({ action: 'create', mode: 'group', publication: 'published', ...common }))).tasks[0].id;
  const separate = await save(page.request, operation({ action: 'create', mode: 'separate', publication: 'published', ...common, title: 'Synthetic independent check' }));
  expect(separate.tasks).toHaveLength(2);
  for (const row of separate.tasks) { const value = await task(page.request, row.id); expect(value.assignees).toHaveLength(1); if (value.assignees[0].id === employeeAgent) employeeTask = row.id; else managerTask = row.id; }
  expect((await data(page.request)).counts).toEqual({ total: 4, open: 4, done: 0, overdue: 0 });
  for (const account of ['employee', 'manager', 'admin', 'foreign']) {
    const context = await browser.newContext(); const child = await context.newPage(); await login(child, account);
    const response = await child.request.get(path());
    if (account === 'foreign') { expect(response.status()).toBe(403); }
    else if (account === 'admin') { expect((await response.json()).capabilities.canViewAll).toBe(true); }
    else { const view = await response.json(); expect(view.capabilities.canCreate).toBe(false); expect(view.tasks).toHaveLength(2); expect((await child.request.get(path('&tab=all'))).status()).toBe(403); expect((await child.request.get(detailPath(draftId))).status()).toBe(403); expect((await send(child.request, operation({ action: 'publish', taskId: draftId, revision: 1 }))).status()).toBe(403); }
    await context.close();
  }
  expect((await page.request.get(`/api/quick-tasks?tenantId=${fixture.tenantB}`)).status()).toBe(403);
  expect((await page.request.get(path('&limit=101'))).status()).toBe(400);
  expect((await page.request.get(path(`&tenantId=${fixture.tenantB}`))).status()).toBe(400);
});

test('desktop owner creates a draft, publishes, edits, archives and restores retained completion', async ({ page }) => {
  await login(page); await page.goto(`/quick-tasks?company=${fixture.tenantA}`);
  await page.getByRole('button', { name: 'Add task', exact: true }).click();
  await page.getByLabel('Task title', { exact: true }).fill('Synthetic desktop lifecycle');
  await page.getByLabel('Description', { exact: true }).fill('Original synthetic desktop review');
  await page.getByLabel('Assign Synthetic employee', { exact: true }).check();
  await page.getByRole('button', { name: 'Save draft', exact: true }).click();
  await expect(page.locator('.task-notice')).toContainText('updated');
  const view = await data(page.request); const created = view.tasks.find(t => t.title === 'Synthetic desktop lifecycle')!;
  expect(created.publication).toBe('draft');
  await page.getByRole('button', { name: 'View task Synthetic desktop lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Publish task', exact: true }).click();
  await expect(page.locator('.task-detail')).toContainText('Open');
  await page.getByRole('button', { name: 'Edit task', exact: true }).click();
  await page.getByLabel('Description', { exact: true }).fill('Updated synthetic details');
  await page.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(page.locator('.task-detail')).toContainText('Updated synthetic details');
  await page.getByRole('button', { name: 'Mark done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reopen task', exact: true })).toBeEnabled();
  await page.screenshot({ path: 'test-results/quick-tasks-live-desktop-detail.png', fullPage: true });
  await page.getByRole('button', { name: 'Archive task', exact: true }).click();
  await page.locator('.task-confirm').getByRole('button', { name: 'Archive task', exact: true }).click();
  await expect(page.locator('.task-notice')).toContainText('updated');
  const archived = await task(page.request, created.id); expect(archived.archived).toBe(true); expect(archived.status).toBe('done');
  await page.getByRole('tab', { name: 'Archived', exact: true }).click();
  await page.getByRole('button', { name: 'View task Synthetic desktop lifecycle', exact: true }).click();
  await page.getByRole('button', { name: 'Restore task', exact: true }).click();
  await page.locator('.task-confirm').getByRole('button', { name: 'Restore task', exact: true }).click();
  await expect(page.locator('.task-notice')).toContainText('updated');
  const restored = await task(page.request, created.id); expect(restored.archived).toBe(false); expect(restored.completed_at).toBe(archived.completed_at); expect(restored.assignees).toEqual(archived.assignees);
  expect(sql(workforceQuery)).toBe(workforceBefore);
});

test('any group assignee completes one shared task; individual tasks keep independent outcomes', async ({ page, browser }) => {
  await login(page, 'employee'); await page.goto(`/quick-tasks?company=${fixture.tenantA}`);
  await expect(page.getByRole('button', { name: 'Add task', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'View task Synthetic shared check', exact: true }).click();
  completion = operation({ action: 'complete', taskId: groupId, revision: 1 }); completionReceipt = await save(page.request, completion);
  expect(await save(page.request, completion)).toEqual(completionReceipt);
  expect(sql(`select count(*) from public.quick_task_audit where operation_id='${completion.operationId}';`)).toBe('1');
  const context = await browser.newContext(); const manager = await context.newPage(); await login(manager, 'manager');
  expect((await task(manager.request, groupId)).status).toBe('done');
  expect((await task(manager.request, managerTask)).status).toBe('open');
  await save(page.request, operation({ action: 'complete', taskId: employeeTask, revision: 1 }));
  expect((await task(page.request, employeeTask)).status).toBe('done'); expect((await task(manager.request, managerTask)).status).toBe('open');
  expect((await send(page.request, operation({ action: 'complete', taskId: managerTask, revision: 1 }))).status()).toBe(403);
  expect((await page.request.get(detailPath(managerTask))).status()).toBe(403);
  await context.close();
});

test('current suspension, relinking and revoked management deny earlier operation receipts', async ({ page }) => {
  await login(page, 'employee');
  sql(`update public.tenant_memberships set status='suspended' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';`);
  expect((await send(page.request, completion)).status()).toBe(403); expect((await page.request.get(path())).status()).toBe(403);
  sql(`update public.tenant_memberships set status='active' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';update public.agents set user_id=null where id='${employeeAgent}';insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,created_by) values('${replacement}','${fixture.tenantA}','${fixture.accounts.employee.id}','Synthetic','Replacement','+447700999123','${fixture.accounts.owner.id}');`);
  expect((await send(page.request, completion)).status()).toBe(403); expect((await data(page.request)).tasks).toEqual([]);
  expect((await page.request.get(detailPath(groupId))).status()).toBe(403);
  sql(`delete from public.agents where id='${replacement}';update public.agents set user_id='${fixture.accounts.employee.id}' where id='${employeeAgent}';`);
  expect(await save(page.request, completion)).toEqual(completionReceipt);
  await login(page, 'admin'); const created = operation({ action: 'create', mode: 'group', publication: 'draft', title: 'Synthetic revoked admin', description: '', agentIds: [employeeAgent], startDate: null, dueDate: null });
  await save(page.request, created);
  sql(`update public.tenant_memberships set role='employee' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`);
  expect((await send(page.request, created)).status()).toBe(403); expect((await page.request.get(path('&tab=all'))).status()).toBe(403);
  sql(`update public.tenant_memberships set role='admin' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`);
  expect(sql(workforceQuery)).toBe(workforceBefore);
});

test('exact counts exceed 1000 and keyset cursors preserve scope, precision and concurrent arrivals', async ({ page }) => {
  await login(page);
  sql(`insert into public.quick_tasks(id,tenant_id,title,description,mode,publication,created_by,batch_id,created_at,due_date) select ('69000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${fixture.tenantA}','Synthetic pagination '||n,'','group','published','${fixture.accounts.owner.id}',gen_random_uuid(),'2026-10-03T12:00:00.123456Z','2026-01-01' from generate_series(1,1005)n;insert into public.quick_task_assignees(tenant_id,task_id,agent_id,agent_name) select '${fixture.tenantA}',id,'${employeeAgent}','Synthetic employee' from public.quick_tasks where id::text like '69000000-%';`);
  const before = await data(page.request, '&search=Synthetic%20pagination&limit=2'); expect(before.counts).toEqual({ total: 1005, open: 1005, done: 0, overdue: 1005 }); expect(before.tasks).toHaveLength(2); expect(before.tasks[0].created_at).toContain('.123456');
  const visited = before.tasks.map(t => t.id); let cursor = before.nextCursor;
  await save(page.request, operation({ action: 'create', mode: 'group', publication: 'published', title: 'Synthetic pagination later arrival', description: '', agentIds: [employeeAgent], startDate: null, dueDate: null }));
  while (cursor) { const next = await data(page.request, `&search=Synthetic%20pagination&limit=100&cursor=${encodeURIComponent(cursor)}`); visited.push(...next.tasks.map(t => t.id)); cursor = next.nextCursor; }
  expect(visited).toHaveLength(1005); expect(new Set(visited).size).toBe(1005);
  expect((await page.request.get(path(`&search=other&cursor=${before.nextCursor}`))).status()).toBe(400);
  sql(`update public.tenants set time_zone='America/Havana' where id='${fixture.tenantA}';`);
  expect((await page.request.get(path(`&search=Synthetic%20pagination&cursor=${before.nextCursor}`))).status()).toBe(400);
  expect((await data(page.request)).timeZone).toBe('America/Havana');
  sql(`update public.tenants set time_zone='Europe/London' where id='${fixture.tenantA}';`);
  expect(sql(workforceQuery)).toBe(workforceBefore);
});

test('lost committed acknowledgement locks recovery and retries the exact operation once', async ({ page }) => {
  await login(page, 'employee'); await page.goto(`/quick-tasks?company=${fixture.tenantA}`);
  await page.getByRole('button', { name: 'View task Synthetic pagination later arrival', exact: true }).click();
  let lost: Operation | undefined; const bodies: Operation[] = [];
  await page.route('**/api/quick-tasks', async route => {
    if (route.request().method() !== 'POST') return route.continue();
    const body = route.request().postDataJSON() as Operation; bodies.push(body);
    if (!lost) { lost = body; const response = await route.fetch(); expect(response.status()).toBe(200); return route.abort('failed'); }
    return route.continue();
  });
  await page.getByRole('button', { name: 'Mark done', exact: true }).click(); await expect(page.locator('.task-recovery')).toBeVisible();
  const storageKey = `ct-alt:quick-tasks:${fixture.accounts.employee.id}:${fixture.tenantA}`;
  expect(await page.evaluate(key => JSON.parse(sessionStorage.getItem(key)!), storageKey)).toEqual({ operationId: lost!.operationId, action: 'complete' });
  await page.route('**/api/quick-tasks?**', route => route.fulfill({ status: 503, json: { error: 'Synthetic recovery failure' } }));
  await page.getByRole('button', { name: 'Refresh to recover', exact: true }).click(); await expect(page.locator('.task-error')).toContainText('could not be loaded');
  expect(await page.evaluate(key => sessionStorage.getItem(key) !== null, storageKey)).toBe(true); await expect(page.getByRole('button', { name: 'Mark done', exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/quick-tasks-live-desktop-recovery.png', fullPage: true });
  await page.unroute('**/api/quick-tasks?**'); await page.getByRole('button', { name: 'Retry last action', exact: true }).click();
  await expect(page.locator('.task-notice')).toContainText('updated'); expect(bodies).toEqual([lost, lost]);
  expect(sql(`select count(*) from public.quick_task_audit where operation_id='${lost!.operationId}';`)).toBe('1');
  expect(await page.evaluate(key => sessionStorage.getItem(key), storageKey)).toBeNull();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(sql(workforceQuery)).toBe(workforceBefore);
});
