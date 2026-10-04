import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (realpathSync(process.cwd()) !== realpathSync(root) || JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name !== 'ct-alt') throw Error('Run only from this independent CT Alt repository.');
const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
if (remote.status !== 0 || !/^(https:\/\/github\.com\/|git@github\.com:)Jare7028\/CT-Alt(?:\.git)?$/i.test(remote.stdout.trim())) throw Error('Refusing an unverified repository binding.');
// The existing fixture verifies pinned image digests and random owned Docker labels.
const lock = '/tmp/ct-alt-overview-test-lock';
const fixtures = '/tmp/ct-alt-local-fixtures.json';
if (existsSync(fixtures)) throw Error('Refusing an existing local fixture file. Stop its owning test first.');
mkdirSync(lock);
let originalEnv;
let originalMode;
let envCaptured = false;
let config;
let fixture;
let server;
let command;
let cleanupPromise;
function run(args, env) {
  const child = spawn(process.execPath, args, { cwd: root, stdio: 'inherit', env });
  command = child;
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Knowledge Base acceptance command failed.')));
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
    if (envCaptured) {
      if (originalEnv) { writeFileSync(resolve(root, '.env.local'), originalEnv, { mode: originalMode }); chmodSync(resolve(root, '.env.local'), originalMode); }
      else rmSync(resolve(root, '.env.local'), { force: true });
    }
    if (fixture) rmSync(fixtures, { force: true });
    if (config) rmSync(config, { force: true });
    rmSync(lock, { recursive: true, force: true });
  })();
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.once(signal, () => { void cleanup().finally(() => process.exit(code)); });
try {
  originalEnv = existsSync(resolve(root, '.env.local')) ? readFileSync(resolve(root, '.env.local')) : null;
  originalMode = originalEnv ? statSync(resolve(root, '.env.local')).mode & 0o777 : 0o600;
  envCaptured = true;
  for (const port of [5180, 54821, 54824, 54825, 54826]) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error(`Owned fixture port ${port} is busy.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  fixture = spawn(process.execPath, ['scripts/overview-browser-fixture.mjs'], { cwd: root, stdio: 'inherit' });
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (fixture.exitCode !== null || fixture.signalCode !== null) throw Error('Owned fixture failed to start.');
    if (existsSync(fixtures)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw Error('Owned fixture startup timed out.');
  const settings = JSON.parse(readFileSync(fixtures, 'utf8'));
  if (settings.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(settings.fixtureLabel) || typeof settings.key !== 'string') throw Error('Wrong owned fixture settings.');
  const configPath = `/tmp/ct-alt-knowledge-base-auth-${settings.fixtureLabel}.config.mjs`;
  // This dedicated test is outside the shared tests/browser configuration.
  writeFileSync(configPath, `export default ${JSON.stringify({ testDir: resolve(root, 'tests'), testMatch: 'knowledge-base-auth-browser.spec.mjs', workers: 1, retries: 0, outputDir: resolve(root, 'test-results'), use: { baseURL: 'http://127.0.0.1:5180', headless: true, viewport: { width: 1444, height: 960 }, launchOptions: { executablePath: process.env.CT_ALT_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] } } })};\n`, { mode: 0o600, flag: 'wx' });
  config = configPath;
  const env = { ...process.env, NEXT_PUBLIC_SUPABASE_URL: settings.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.key, NEXT_TELEMETRY_DISABLED: '1' };
  await run(['node_modules/next/dist/bin/next', 'build'], env);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '5180'], { cwd: root, stdio: 'inherit', env });
  ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null || server.signalCode !== null) throw Error('Owned application failed to start.');
    try { if ((await fetch('http://127.0.0.1:5180/login')).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw Error('Owned application startup timed out.');
  await run(['node_modules/@playwright/test/cli.js', 'test', '--config', config], env);
} finally {
  await cleanup();
}
