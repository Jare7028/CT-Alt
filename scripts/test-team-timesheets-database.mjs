import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
// Every run owns a new network-disabled container, without URLs or fixture ports.
const name = 'ct-alt-team-timesheets-' + randomUUID();
const image = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
const tenant = '60000000-0000-0000-0000-000000000001';
const actor = "set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';";
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr);
  return result;
}
const psql = ['exec', '-i', name, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'ct_alt_test'];
const sql = content => docker(psql, content);
function asyncSql(content) {
  const child = spawn('docker', psql, { timeout: 60_000 }); let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; }); child.stderr.on('data', chunk => { stderr += chunk; }); child.stdin.end(content);
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('close', status => resolve({ status, stdout, stderr })); });
}
async function barrier() {
  for (let i = 0; i < 100; i++) {
    if (sql("select count(*) from pg_stat_activity where application_name='ct_alt_team_snapshot' and wait_event='PgSleep';").stdout.trim() === '1') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Team export did not reach its statement barrier');
}
function snapshot() {
  return sql(`create temporary table retained(table_id oid,rows jsonb);
do $$declare tbl regclass;begin for tbl in select c.oid::regclass from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' loop
 execute format('insert into retained select %L::oid, coalesce(jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text), %L::jsonb) from %s r',tbl::oid,'[]',tbl);end loop;end;$$;
select jsonb_build_object('rows',(select jsonb_agg(to_jsonb(r) order by table_id) from retained r),
'functions',(select jsonb_agg(jsonb_build_object('id',p.oid,'owner',p.proowner,'source',p.prosrc,'acl',p.proacl,'config',p.proconfig,'definer',p.prosecdef,'volatility',p.provolatile) order by p.oid)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','workforce_private') and p.proname<>'read_team_timesheets'));`).stdout.trim();
}
async function races() {
  const day = sql(`select (statement_timestamp() at time zone 'Europe/London')::date;`).stdout.trim();
  const query = `public.read_team_timesheets('${tenant}','${day}','${day}',null,1,null,true)`;
  const original = JSON.parse(sql(actor + `select ${query};`).stdout);
  const reader = asyncSql("set application_name='ct_alt_team_snapshot';" + actor + `with barrier as materialized(select pg_sleep(2)) select ${query} from barrier;`);
  await barrier();
  sql(actor + `select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_in','jobId',(select id from public.time_clock_jobs where name='Race')));
select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_out','entryId',public.read_time_clock('${tenant}')->'entry'->>'id','revision',1));`);
  const old = await reader; assert.equal(old.status, 0, old.stderr);
  const retained = JSON.parse(old.stdout); assert.deepEqual(retained.summary, original.summary);
  assert.deepEqual(retained.entries, original.entries); assert.equal(retained.datasetVersion, original.datasetVersion);
  const latest = JSON.parse(sql(actor + `select ${query};`).stdout);
  assert.equal(latest.summary.entryCount, original.summary.entryCount + 1);
  assert.equal(latest.entries.length, latest.summary.entryCount); assert.notEqual(latest.datasetVersion, original.datasetVersion);
  const messages = ['PASS: delayed bounded export retains one snapshot of counts/totals/records/version across a real concurrent completion', 'PASS: subsequent export contains the entire committed scope'];
  // Ensure a real second record exists regardless of baseline start-date scope.
  sql(actor + `select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_in','jobId',(select id from public.time_clock_jobs where name='Race')));
select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_out','entryId',public.read_time_clock('${tenant}')->'entry'->>'id','revision',1));`);
  const first = JSON.parse(sql(actor + `select public.read_team_timesheets('${tenant}','${day}','${day}',null,1);`).stdout);
  assert.ok(first.nextCursor);
  sql(actor + `select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_in','jobId',(select id from public.time_clock_jobs where name='Race')));
select public.save_time_clock('${tenant}',gen_random_uuid(),jsonb_build_object('action','clock_out','entryId',public.read_time_clock('${tenant}')->'entry'->>'id','revision',1));`);
  const page = await asyncSql(actor + `select public.read_team_timesheets('${tenant}','${day}','${day}',null,1,'${JSON.stringify(first.nextCursor)}'::jsonb);`);
  assert.equal(page.status, 3); assert.match(page.stderr, /40001/);
  messages.push('PASS: real completion invalidates an older cursor instead of silently mixing review pages');
  const revokedReader = asyncSql("set application_name='ct_alt_team_snapshot';" + actor + `with barrier as materialized(select pg_sleep(2)) select ${query} from barrier;`);
  await barrier(); sql(`update public.tenant_memberships set status='suspended' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000301';`);
  assert.equal((await revokedReader).status, 0);
  const denied = await asyncSql(actor + `select ${query};`); assert.equal(denied.status, 3); assert.match(denied.stderr, /42501/);
  messages.push('PASS: stable authorization uses its statement snapshot and the next export denies current revocation');
  return messages;
}
let started = false;
try {
  docker(['run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=ct_alt_test', image]); started = true;
  let ready = false;
  for (let i = 0; i < 60; i++) { if (spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'ct_alt_test'], { stdio: 'ignore', timeout: 5000 }).status === 0) { ready = true; break; } await new Promise(resolve => setTimeout(resolve, 500)); }
  if (!ready) throw new Error('Owned local database unavailable');
  sql(readFileSync(new URL('../tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
  const directory = new URL('../supabase/migrations/', import.meta.url), files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  const candidates = files.filter(file => file.endsWith('_team_timesheets.sql')); assert.equal(candidates.length, 1); const migration = candidates[0];
  for (const file of files.filter(file => file < migration)) sql(readFileSync(new URL(file, directory), 'utf8'));
  const baseline = sql(readFileSync(new URL('../tests/database/time-clock.sql', import.meta.url), 'utf8'));
  const before = snapshot(); sql(readFileSync(new URL(migration, directory), 'utf8')); assert.equal(snapshot(), before);
  for (const file of files.filter(file => file > migration)) sql(readFileSync(new URL(file, directory), 'utf8'));
  const result = sql(readFileSync(new URL('../tests/database/team-timesheets.sql', import.meta.url), 'utf8'));
  const checks = ['PASS: additive upgrade preserves all populated public rows and existing function owner/ACL/security/source'];
  checks.push(...result.stderr.split('\n').filter(line => line.includes('PASS:')), ...await races());
  console.log(`${baseline.stderr.split('\n').filter(line => line.includes('PASS:')).length} existing Time Clock SQL assertions passed before upgrade.`);
  console.log(checks.join('\n')); console.log(`${checks.length} team-timesheet SQL/upgrade/snapshot assertions passed in isolated PostgreSQL 17.`);
} finally { if (started) docker(['rm', '-f', name]); }
