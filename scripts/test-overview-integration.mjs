import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

const lock = '/tmp/ct-alt-overview-test-lock';
const fixtures = '/tmp/ct-alt-local-fixtures.json';
if (existsSync(fixtures)) throw Error('Refusing an existing local fixture file. Stop its owning test first.');
mkdirSync(lock);
const originalEnv = existsSync('.env.local') ? readFileSync('.env.local') : null;
let fixture;
let server;
function run(args) {
  const child = spawn(process.execPath, args, { stdio: 'inherit' });
  return new Promise((resolve, reject) => { child.on('error', reject); child.on('exit', code => code === 0 ? resolve() : reject(Error('Overview acceptance command failed.'))); });
}
async function stop(child) {
  if (!child || child.exitCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  child.kill('SIGTERM'); await exited;
}
try {
  for (const port of [5180, 54821, 54824, 54825, 54826]) {
    await new Promise((resolve, reject) => {
      const probe = createServer(); probe.once('error', () => reject(Error(`Owned fixture port ${port} is busy.`))); probe.listen(port, '127.0.0.1', () => probe.close(resolve));
    });
  }
  fixture = spawn(process.execPath, ['scripts/overview-browser-fixture.mjs'], { stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (fixture.exitCode !== null) throw Error('Owned fixture failed to start.');
    if (existsSync(fixtures)) { ready = true; break; } await delay(250);
  }
  if (!ready) throw Error('Owned fixture startup timed out.');
  await run(['node_modules/next/dist/bin/next', 'build']);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '5180'], { stdio: 'inherit' });
  for (let i = 0; i < 40; i++) {
    try { if ((await fetch('http://127.0.0.1:5180/login')).ok) break; } catch {} await delay(250);
  }
  await run(['node_modules/@playwright/test/cli.js', 'test', 'tests/browser/overview.spec.ts']);
} finally {
  await stop(server); await stop(fixture);
  if (originalEnv) writeFileSync('.env.local', originalEnv); else rmSync('.env.local', { force: true });
  // The exclusive lock and absent-file preflight establish ownership.
  if (fixture) rmSync(fixtures, { force: true });
  rmSync(lock, { recursive: true, force: true });
}
