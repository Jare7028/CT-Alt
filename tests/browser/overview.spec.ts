import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const fixture = JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json', 'utf8'));
const db = 'supabase_db_ct-alt-independent';
test.describe.configure({ mode: 'serial' });
if (fixture.url !== 'http://127.0.0.1:54821' || !fixture.fixtureLabel) throw Error('Owned local fixture required');
function sql(query: string) {
  const label = spawnSync('docker', ['inspect', db, '--format', '{{index .Config.Labels "ct-alt.test"}}'], { encoding: 'utf8' });
  if (label.status !== 0 || label.stdout.trim() !== fixture.fixtureLabel) throw Error('Wrong fixture database');
  const result = spawnSync('docker', ['exec', '-i', db, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres'], { input: query, encoding: 'utf8' });
  if (result.status !== 0) throw Error(result.stderr);
}
async function login(page: Page, account = 'owner') {
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(fixture.accounts[account].email);
  await page.getByLabel('Password', { exact: true }).fill(fixture.accounts[account].password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page).toHaveURL(/\/agents/);
}
const overview = `/api/overview?tenantId=${fixture.tenantA}`;
const activity = `/api/activity?tenantId=${fixture.tenantA}`;
test.beforeAll(() => {
  sql(`insert into public.agents(tenant_id,first_name,last_name,phone,created_by,status)
    select '${fixture.tenantA}','Bulk','Synthetic '||n,'+4477008'||lpad(n::text,5,'0'),'${fixture.accounts.owner.id}',case when n<=1200 then 'active' else 'archived' end from generate_series(1,1300)n;
    insert into public.agent_audit(tenant_id,agent_id,actor_user_id,actor_name,action,revision,occurred_at)
    select '${fixture.tenantA}',a.id,'${fixture.accounts.owner.id}','Synthetic owner',case when n%2=0 then 'created' else 'updated' end,1,'2026-10-03T12:00:00.123456Z' from generate_series(1,65)n cross join public.agents a where a.tenant_id='${fixture.tenantA}' and a.user_id='${fixture.accounts.owner.id}';
    insert into public.agent_audit(id,tenant_id,agent_id,actor_user_id,actor_name,action,revision,occurred_at) overriding system value
    select n,'${fixture.tenantA}',a.id,'${fixture.accounts.owner.id}','Synthetic owner','updated',1,'2026-10-03T12:00:00.123456Z' from (values(9007199254740992::bigint),(9007199254740993::bigint))v(n) cross join public.agents a where a.tenant_id='${fixture.tenantA}' and a.user_id='${fixture.accounts.owner.id}';`);
});

test('exact counts exceed directory limits; real keyset pagination preserves bigint and concurrent history', async ({ page }) => {
  await login(page);
  const response = await page.request.get(overview);
  expect(response.status()).toBe(200); expect(response.headers()['cache-control']).toContain('no-store');
  const data = await response.json(); expect(data.agents).toEqual({ active: 1204, archived: 100, linked: 4, unlinked: 1200 });
  expect(data.memberships).toEqual({ owner: 1, admin: 1, manager: 1, employee: 1 });
  const first = await page.request.get(`${activity}&limit=2`); expect(first.status()).toBe(200);
  const firstData = await first.json(); expect(firstData.events.map((row: {id:string}) => row.id)).toEqual(['9007199254740993', '9007199254740992']);
  expect(firstData.events[0]).not.toHaveProperty('phone'); expect(firstData.events[0].occurred_at).toContain('.123456');
  sql(`insert into public.agent_audit(id,tenant_id,agent_id,actor_user_id,actor_name,action,revision,occurred_at) overriding system value select 9007199254740994,'${fixture.tenantA}',id,'${fixture.accounts.owner.id}','Synthetic owner','created',1,'2026-10-03T12:00:00.123456Z' from public.agents where user_id='${fixture.accounts.owner.id}' and tenant_id='${fixture.tenantA}';`);
  const ids: string[] = firstData.events.map((row: {id:string}) => row.id); let cursor = firstData.nextCursor;
  while (cursor) {
    const next = await page.request.get(`${activity}&limit=10&cursor=${encodeURIComponent(cursor)}`); expect(next.status()).toBe(200);
    const body = await next.json(); ids.push(...body.events.map((row: {id:string}) => row.id)); cursor = body.nextCursor;
  }
  expect(ids).toHaveLength(67); expect(new Set(ids).size).toBe(67); expect(ids).not.toContain('9007199254740994');
  expect(ids).toEqual([...ids].sort((a,b) => BigInt(a) > BigInt(b) ? -1 : 1)); expect(ids.indexOf('10')).toBeLessThan(ids.indexOf('9'));
  expect((await page.request.get(`${activity}&action=created&cursor=${encodeURIComponent(firstData.nextCursor)}`)).status()).toBe(400);
  expect((await page.request.get(`${activity}&startDate=2026-10-04&endDate=2026-10-03`)).status()).toBe(400);
});

test('company-calendar dates are inclusive and timezone changes refresh correctly', async ({ page }) => {
  await login(page);
  sql(`insert into public.agent_audit(tenant_id,agent_id,actor_user_id,actor_name,action,revision,occurred_at) select '${fixture.tenantA}',a.id,'${fixture.accounts.owner.id}','Synthetic boundary','restored',1,t::timestamptz from (values('2026-10-02T22:59:59.999999Z'),('2026-10-02T23:00:00Z'),('2026-10-03T22:59:59.999999Z'),('2026-10-03T23:00:00Z'))v(t) cross join public.agents a where a.user_id='${fixture.accounts.owner.id}' and a.tenant_id='${fixture.tenantA}';`);
  const filtered = await page.request.get(`${activity}&action=restored&startDate=2026-10-03&endDate=2026-10-03`);
  expect(filtered.status()).toBe(200); expect((await filtered.json()).events).toHaveLength(2);
  await page.goto(`/overview?company=${fixture.tenantA}`);
  await expect(page.locator('.overview-recent')).toContainText('Europe/London');
  try {
    sql(`update public.tenants set time_zone='America/New_York' where id='${fixture.tenantA}';`);
    await page.getByRole('button', { name: 'Refresh overview' }).click();
    await expect(page.locator('.overview-recent')).toContainText('America/New_York');
    await page.goto(`/activity?company=${fixture.tenantA}`);
    sql(`update public.tenants set time_zone='Europe/London' where id='${fixture.tenantA}';`);
    await page.getByRole('button', { name: 'Refresh activity' }).click();
    await expect(page.locator('.activity-context')).toContainText('Europe/London');
  } finally { sql(`update public.tenants set time_zone='Europe/London' where id='${fixture.tenantA}';`); }
});

test('server and UI enforce roles, foreign companies and revocation with existing signed cookies', async ({ page, browser }) => {
  expect((await page.request.get(overview)).status()).toBe(401);
  await login(page, 'manager'); expect((await page.request.get(overview)).status()).toBe(200); expect((await page.request.get(activity)).status()).toBe(403);
  await page.goto(`/overview?company=${fixture.tenantA}`); await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);
  expect((await page.request.get(`/api/overview?tenantId=${fixture.tenantB}`)).status()).toBe(403);
  try {
    sql(`update public.tenant_memberships set role='employee' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.manager.id}';`);
    expect((await page.request.get(overview)).status()).toBe(403);
    await page.getByRole('button', { name: 'Refresh overview' }).click(); await expect(page.locator('.overview-error')).toContainText('access has changed'); await expect(page.locator('.overview-metric')).toHaveCount(0);
  } finally { sql(`update public.tenant_memberships set role='manager' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.manager.id}';`); }
  for (const account of ['employee','foreign','admin']) {
    const context = await browser.newContext(); const next = await context.newPage(); await login(next, account);
    if (account !== 'admin') { expect((await next.request.get(overview)).status()).toBe(403); expect((await next.request.get(activity)).status()).toBe(403); }
    else {
      await next.goto(`/activity?company=${fixture.tenantA}`); await expect(next.locator('.activity-log li')).toHaveCount(50);
      try {
        sql(`update public.tenant_memberships set status='suspended' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`);
        expect((await next.request.get(activity)).status()).toBe(403); await next.getByRole('button', { name: 'Refresh activity' }).click(); await expect(next.locator('.activity-error')).toContainText('access has changed'); await expect(next.locator('.activity-log li')).toHaveCount(0);
      } finally { sql(`update public.tenant_memberships set status='active' where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.admin.id}';`); }
    }
    await context.close();
  }
});

test('live screens have company-aware navigation and fit desktop and mobile', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message)); await login(page);
  for (const moduleName of ['overview','activity']) {
    await page.goto(`/${moduleName}?company=${fixture.tenantA}`);
    await expect(page.locator('.ct-sidebar a[aria-current="page"]')).toHaveText(moduleName === 'overview' ? 'Overview' : 'Activity');
    for (const width of [1444, 900, 390]) {
      await page.setViewportSize({ width, height: 960 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await page.screenshot({ path: `test-results/${moduleName}-live-${width}.png`, fullPage: moduleName === 'overview' });
    }
    await page.getByRole('button', { name: 'Open navigation' }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('link', { name: 'Users', exact: true })).toHaveAttribute('href', `/agents?company=${fixture.tenantA}`);
    await dialog.getByRole('button', { name: 'Close navigation' }).click();
  }
  await page.goto(`/chat?company=${fixture.tenantA}`);
  await page.setViewportSize({ width: 1444, height: 960 });
  await expect(page.locator('.ct-sidebar').getByRole('link', { name: 'Activity', exact: true })).toHaveAttribute('href', `/activity?company=${fixture.tenantA}`);
  expect(errors).toEqual([]);
});
