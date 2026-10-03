import { spawnSync } from 'node:child_process';
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
let started = false;
try {
  docker(['run', '-d', '--name', name, '--network', 'none', '--tmpfs', '/var/lib/postgresql/data', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust', '-e', 'POSTGRES_DB=ct_alt_test', image]);
  started = true;
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    const result = spawnSync('docker', ['exec', name, 'pg_isready', '-U', 'postgres', '-d', 'ct_alt_test'], { stdio: 'ignore', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  if (!ready) throw new Error('Isolated test database did not become ready');
  sql(readFileSync(new URL('../tests/database/bootstrap.sql', import.meta.url), 'utf8'));
  const directory = new URL('../supabase/migrations/', import.meta.url);
  for (const file of readdirSync(directory).filter(file => file.endsWith('.sql')).sort()) {
    sql(readFileSync(new URL(file, directory), 'utf8'));
  }
  const result = sql(readFileSync(new URL('../tests/database/foundation.sql', import.meta.url), 'utf8'));
  const checks = result.split('\n').filter(line => line.includes('PASS:'));
  console.log(checks.join('\n'));
  console.log(`${checks.length} database assertions passed in isolated PostgreSQL 17.`);
} finally {
  if (started) docker(['rm', '-f', name]);
}
