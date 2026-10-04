import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

// No URLs, hosted connections, Auth ports or shared database state are accepted.
const name = `ct-alt-overview-snapshot-${randomUUID()}`;
const image = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const tenant = '72000000-0000-4000-8000-000000000001';
const actor = "set role authenticated; set request.jwt.claim.sub='71000000-0000-4000-8000-000000000001';";
const query = `select public.read_workforce_overview('${tenant}');`;
const initial = { agents: { active: 1204, archived: 17, linked: 1003, unlinked: 201 }, memberships: { owner: 1, admin: 3, manager: 1, employee: 1202 } };
const changed = { agents: { active: 1205, archived: 19, linked: 1002, unlinked: 203 }, memberships: { owner: 1, admin: 3, manager: 2, employee: 1201 } };
const modify = `begin;
update public.agents set status='archived' where tenant_id='${tenant}' and id in ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002');
update public.agents set user_id='71000000-0000-4000-8000-000000001014' where id='73000000-0000-4000-8000-000000001004';
update public.tenant_memberships set role='manager' where tenant_id='${tenant}' and user_id='71000000-0000-4000-8000-000000001014';
insert into public.agents(id,tenant_id,first_name,last_name,phone,created_by)
select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'${tenant}','Synthetic','Race '||n,'+4477'||lpad(n::text,8,'0'),'71000000-0000-4000-8000-000000000001' from generate_series(1230,1232) n;
commit;`;
const restore = `begin;
delete from public.agents where tenant_id='${tenant}' and id in ('73000000-0000-4000-8000-000000001230','73000000-0000-4000-8000-000000001231','73000000-0000-4000-8000-000000001232');
update public.agents set status='active' where tenant_id='${tenant}' and id in ('73000000-0000-4000-8000-000000000001','73000000-0000-4000-8000-000000000002');
update public.agents set user_id=null where id='73000000-0000-4000-8000-000000001004';
update public.tenant_memberships set role='employee' where tenant_id='${tenant}' and user_id='71000000-0000-4000-8000-000000001014';
commit;`;
const psql = ['exec', '-i', name, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'ct_alt_test'];
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Docker command failed');
  return result;
}
function sql(content) { return docker(psql, content); }
function asyncSql(content) {
  const child = spawn('docker', psql, { timeout: 60_000 });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(content);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout, stderr }));
  });
}
async function barrier() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (sql("select count(*) from pg_stat_activity where application_name='ct_alt_overview_snapshot' and wait_event='PgSleep';").stdout.trim() === '1') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Snapshot reader did not reach its statement barrier');
}
function payload(result) {
  assert.equal(result.status ?? 0, 0, result.stderr);
  return JSON.parse(result.stdout.trim());
}
async function raceChecks() {
  // Delay evaluation after the reader statement's MVCC snapshot is established.
  // The concurrent transaction archives, links, creates and changes a role.
  const reader = asyncSql("set application_name='ct_alt_overview_snapshot';" + actor +
    `with barrier as materialized (select pg_sleep(2)) select public.read_workforce_overview('${tenant}') from barrier;`);
  await barrier();
  sql(modify);
  assert.deepEqual(payload(await reader), initial);
  assert.deepEqual(payload(sql(actor + query)), changed);
  const messages = ['PASS: stable invoker reads the original statement snapshot after concurrent archive/relink/create/role commits', 'PASS: next statement reads the complete committed snapshot'];
  sql(restore);

  const writer = asyncSql(Array.from({ length: 30 }, () => modify + 'select pg_sleep(0.005);' + restore).join('\n'));
  const reads = await asyncSql(actor + Array.from({ length: 100 }, () => query + 'select pg_sleep(0.003);').join('\n'));
  const wrote = await writer;
  assert.equal(wrote.status, 0, wrote.stderr);
  assert.equal(reads.status, 0, reads.stderr);
  const snapshots = reads.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line));
  assert.equal(snapshots.length, 100);
  for (const snapshot of snapshots) {
    assert.equal(snapshot.agents.active, snapshot.agents.linked + snapshot.agents.unlinked);
    assert.ok([initial, changed].some(expected => isDeepStrictEqual(snapshot, expected)), 'Counts crossed committed snapshot boundaries');
  }
  messages.push('PASS: 100 reads stay coherent during 30 atomic archive/relink/create/role cycles');

  // Revocation uses the same statement snapshot; subsequent requests are denied.
  const revokedReader = asyncSql("set application_name='ct_alt_overview_snapshot';" + actor +
    `with barrier as materialized (select pg_sleep(2)) select public.read_workforce_overview('${tenant}') from barrier;`);
  await barrier();
  sql(`update public.tenant_memberships set status='suspended' where tenant_id='${tenant}' and user_id='71000000-0000-4000-8000-000000000001';`);
  assert.deepEqual(payload(await revokedReader), initial);
  const revoked = await asyncSql(actor + query);
  assert.equal(revoked.status, 3);
  assert.match(revoked.stderr, /42501/);
  messages.push('PASS: concurrent revocation respects the statement snapshot and denies the next read');
  return messages;
}
let started = false;
try {
  docker(['run', '-d', '--label', `ct-alt.test-runner-pid=${process.pid}`, '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=ct_alt_test', image]);
  started = true; registerDatabaseFixture(name);
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'ct_alt_test'], { stdio: 'ignore', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Isolated test database did not become ready');
  sql(readFileSync(new URL('../tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  storageFixture = await startDatabaseStorage(name);
  // Model permissive function defaults too: the new RPC must remove them.
  sql('alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;');
  const directory = new URL('../supabase/migrations/', import.meta.url);
  const migrations = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  const snapshotMigrations = migrations.filter(file => file.endsWith('_workforce_overview_snapshot.sql'));
  assert.equal(snapshotMigrations.length, 1, 'Exactly one overview snapshot migration is required');
  const migration = snapshotMigrations[0];
  for (const file of migrations.filter(file => file < migration)) sql(readFileSync(new URL(file, directory), 'utf8'));
  const suite = readFileSync(new URL('../tests/database/overview-snapshot.sql', import.meta.url), 'utf8');
  const assertionsAt = suite.indexOf('select pg_temp.check_true((select not prosecdef');
  assert.ok(assertionsAt > 0, 'SQL fixture/assertion boundary must exist');
  // Apply the additive migration to a populated database, preserving every row
  // and all existing function definitions, ownership, ACLs and security flags.
  const beforeUpgrade = `
create temporary table overview_before_rows(table_id oid, rows jsonb);
do $$declare tbl regclass;begin
 for tbl in select c.oid::regclass from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
  execute format('insert into overview_before_rows select %L::oid, coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), %L::jsonb) from %s r',tbl::oid,'[]',tbl);
 end loop;
end;$$;
create temporary table overview_before_functions as
 select p.oid,p.proowner,p.prosrc,p.proacl,p.proconfig,p.prosecdef,p.provolatile from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','workforce_private');
`;
  const afterUpgrade = `
do $$declare snapshot record; current_rows jsonb;begin
 for snapshot in select * from overview_before_rows loop
  execute format('select coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), %L::jsonb) from %s r','[]',snapshot.table_id::regclass) into current_rows;
  perform pg_temp.check_true(current_rows=snapshot.rows,'populated upgrade preserves every row in '||snapshot.table_id::regclass);
 end loop;
end;$$;
select pg_temp.check_true(not exists(
 select 1 from overview_before_functions b left join pg_proc p on p.oid=b.oid
 where p.oid is null or row(p.proowner,p.prosrc,p.proacl,p.proconfig,p.prosecdef,p.provolatile) is distinct from row(b.proowner,b.prosrc,b.proacl,b.proconfig,b.prosecdef,b.provolatile)
),'populated upgrade preserves all existing functions and owner/ACL/security settings');
`;
  const laterMigrations = migrations.filter(file => file > migration).map(file => readFileSync(new URL(file, directory), 'utf8')).join('\n');
  const result = sql(suite.slice(0, assertionsAt) + beforeUpgrade + readFileSync(new URL(migration, directory), 'utf8') + afterUpgrade + laterMigrations + suite.slice(assertionsAt));
  const checks = result.stderr.split('\n').filter(line => line.includes('PASS:'));
  checks.push(...await raceChecks());
  console.log(checks.join('\n'));
  console.log(`${checks.length} overview snapshot assertions passed in isolated PostgreSQL 17.`);
} finally { try {storageFixture?.cleanup();} finally {
  if (started) docker(['rm', '-f', name]);
}}
