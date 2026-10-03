import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

// No supplied database URL or remote connection is accepted. Every run owns a
// new network-disabled, unpublished container and removes only that container.
const name = `ct-alt-foundation-${randomUUID()}`;
const image = 'postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args, input) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 120_000 });
  if (result.error || result.status !== 0) throw new Error(result.error?.message || result.stderr || 'Docker command failed');
  return result;
}
function sql(content) {
  const result = docker(['exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', 'ct_alt_test'], content);
  return result.stderr;
}
function asyncSql(content) {
  const child = spawn('docker', ['exec', '-i', name, 'psql', '-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-U', 'postgres', '-d', 'ct_alt_test']);
  let stderr = '';
  child.stdout.resume(); child.stderr.on('data', chunk => { stderr += chunk; });
  child.stdin.end(content);
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', status => resolve({ status, stderr }));
  });
}
async function waitingTransaction() {
  for (let i = 0; i < 40; i++) {
    const result = docker(['exec', name, 'psql', '-X', '-At', '-U', 'postgres', '-d', 'ct_alt_test', '-c', "select count(*) from pg_stat_activity where application_name='ct_alt_race' and wait_event='PgSleep'"]);
    if (result.stdout.trim() === '1') return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Concurrent test transaction did not reach lock barrier');
}
const actorSql = "set role authenticated; select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);";
const updateSql = `select public.save_agents('20000000-0000-0000-0000-000000000001', jsonb_build_array(jsonb_build_object('action','update','id',(select id from public.agents where phone='+447700900104'),'revision',2,'first_name','Employee','last_name','Race','phone','+447700900104','custom_fields',jsonb_build_object('client','x'))));`;
async function raceChecks() {
  sql("update public.tenants set status='active' where id='20000000-0000-0000-0000-000000000001';");
  let first = asyncSql("set application_name='ct_alt_race';begin;" + actorSql + updateSql + 'select pg_sleep(2);commit;');
  await waitingTransaction();
  let second = asyncSql(actorSql + updateSql);
  let results = await Promise.all([first, second]);
  if (results[0].status !== 0 || results[1].status !== 3 || !results[1].stderr.includes('40001')) throw new Error('Concurrent revision check failed');
  const messages = ['PASS: simultaneous edits reject the stale writer'];
  first = asyncSql("set application_name='ct_alt_race';begin;update public.tenant_memberships set status='suspended' where tenant_id='20000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000101';select pg_sleep(2);commit;");
  await waitingTransaction();
  second = asyncSql(actorSql + `select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Suspended","last_name":"Race","phone":"+447700900199","custom_fields":{"client":"x"}}]');`);
  results = await Promise.all([first, second]);
  if (results[0].status !== 0 || results[1].status !== 3 || !results[1].stderr.includes('42501')) throw new Error('Concurrent suspension check failed');
  messages.push('PASS: concurrent actor suspension denies a queued mutation');
  return messages;
}
let started = false;
try {
  docker(['run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=ct_alt_test', image]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    // The image briefly starts a socket-only init server and then restarts it.
    // TCP loopback readiness waits for the final server inside this container.
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'ct_alt_test'], { stdio: 'ignore', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Isolated test database did not become ready');
  sql(readFileSync(new URL('../tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    sql(readFileSync(new URL(file, directory), 'utf8'));
  }
  const checks = [];
  for (const suite of ['foundation.sql', 'agents.sql']) {
    const result = sql(readFileSync(new URL('../tests/database/' + suite, import.meta.url), 'utf8'));
    checks.push(...result.split('\n').filter(line => line.includes('PASS:')));
  }
  checks.push(...await raceChecks());
  console.log(checks.join('\n'));
  console.log(`${checks.length} database assertions passed in isolated PostgreSQL 17.`);
} finally {
  if (started) docker(['rm', '-f', name]);
}
