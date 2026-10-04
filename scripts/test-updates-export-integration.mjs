import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

// Shares the Overview fixture's exclusive lock, named local database and ports.
// The fixture pins image digests and verifies its random labels before cleanup.
const lock = '/tmp/ct-alt-overview-test-lock';
const fixtures = '/tmp/ct-alt-local-fixtures.json';
if (existsSync(fixtures)) throw Error('Refusing an existing local fixture file. Stop its owning test first.');
mkdirSync(lock);
const originalEnv = existsSync('.env.local') ? readFileSync('.env.local') : null;
const originalMode = originalEnv ? statSync('.env.local').mode & 0o777 : 0o600;
let fixture;
let server;
let command;
let cleanupPromise;
function run(args, env) {
  const child = spawn(process.execPath, args, { stdio: 'inherit', env });
  command = child;
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Updates export acceptance command failed.')));
  });
}
async function stop(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM'); await exited;
}
function cleanup() {
  return cleanupPromise ??= (async () => {
    await stop(command); await stop(server); await stop(fixture);
    if (originalEnv) writeFileSync('.env.local', originalEnv, { mode: originalMode });
    else rmSync('.env.local', { force: true });
    // Absent-file preflight and the exclusive fixture lock establish ownership.
    if (fixture) rmSync(fixtures, { force: true });
    rmSync(lock, { recursive: true, force: true });
  })();
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
}
try {
  for (const port of [5180, 54821, 54824, 54825, 54826]) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once('error', () => reject(Error(`Owned fixture port ${port} is busy.`)));
      probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  fixture = spawn(process.execPath, ['scripts/overview-browser-fixture.mjs'], { stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (fixture.exitCode !== null || fixture.signalCode !== null) throw Error('Owned fixture failed to start.');
    if (existsSync(fixtures)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw Error('Owned fixture startup timed out.');
  const settings = JSON.parse(readFileSync(fixtures, 'utf8'));
  if (settings.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(settings.fixtureLabel) || typeof settings.key !== 'string') throw Error('Wrong owned fixture settings.');
  // Explicit local binding wins over inherited application configuration.
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: settings.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.key, NEXT_TELEMETRY_DISABLED: '1' };
  await run(['node_modules/next/dist/bin/next', 'build'], env);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '5180'], { stdio: 'inherit', env });
  ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null || server.signalCode !== null) throw Error('Owned application failed to start.');
    try { if ((await fetch('http://127.0.0.1:5180/login')).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw Error('Owned application startup timed out.');
  await run(['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/updates-export.spec.ts'], env);
} finally {
  await cleanup();
}
