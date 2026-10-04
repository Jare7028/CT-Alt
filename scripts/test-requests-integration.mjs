import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const diagnosticDesktop = process.argv.slice(2).length === 1 && process.argv[2] === '--diagnostic-desktop';
const diagnosticRecovery = process.argv.slice(2).length === 1 && process.argv[2] === '--diagnostic-recovery';
if(process.argv.length > 2 && !diagnosticDesktop && !diagnosticRecovery) throw Error('Only the bounded desktop diagnostic flag is supported.');
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
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Requests acceptance command failed.')));
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
  for (let i = 0; i < 360; i++) {
    if (fixture.exitCode !== null || fixture.signalCode !== null) throw Error('Owned fixture failed to start.');
    if (existsSync(fixtures)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw Error('Owned fixture startup timed out.');
  const settings = JSON.parse(readFileSync(fixtures, 'utf8'));
  if (settings.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(settings.fixtureLabel) || typeof settings.key !== 'string') throw Error('Wrong owned fixture settings.');
  const files = (await import('node:fs')).readdirSync(resolve(root,'supabase/migrations')).filter(name=>name.endsWith('.sql'));
  if(files.length!==20 || files.filter(name=>name.endsWith('_requests_board.sql')).length!==1) throw Error('Expected19 retained baselines plus one Requests candidate.');
  const ownership=spawnSync('docker',['inspect','supabase_db_ct-alt-independent','--format','{{index .Config.Labels "ct-alt.test"}}'],{encoding:'utf8'});
  if(ownership.status!==0 || ownership.stdout.trim()!==settings.fixtureLabel) throw Error('Wrong owned Requests fixture database.');
  const installed=spawnSync('docker',['exec','-i','supabase_db_ct-alt-independent','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input:"select to_regclass('public.work_requests')is not null and to_regclass('workforce_private.request_operations')is not null and to_regprocedure('public.save_request(uuid,uuid,text)')is not null;",encoding:'utf8'});
  if(installed.status!==0 || installed.stdout.trim()!=='t') throw Error('Requests candidate did not load into owned fixture.');
  const configPath = `/tmp/ct-alt-requests-auth-${settings.fixtureLabel}.config.mjs`;
  // This dedicated test is outside the shared tests/browser configuration.
  writeFileSync(configPath, `export default ${JSON.stringify({ testDir: resolve(root, 'tests/browser'), testMatch: 'requests.spec.ts', workers: 1, retries: 0, outputDir: resolve(root, 'test-results'), use: { baseURL: 'http://127.0.0.1:5180', headless: true, viewport: { width: 1444, height: 960 }, launchOptions: { executablePath: process.env.CT_ALT_CHROMIUM || '/usr/bin/chromium', args: ['--no-sandbox'] } } })};
`, { mode: 0o600, flag: 'wx' });
  config = configPath;
  const syntax = spawnSync(process.execPath, ['--check', configPath], { cwd: root, encoding: 'utf8' });
  if (syntax.error || syntax.status !== 0) throw Error('Generated Requests browser configuration is invalid: ' + (syntax.error?.message || syntax.stderr));
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
  await run(['node_modules/@playwright/test/cli.js', 'test', '--config', config, ...(diagnosticDesktop ? ['--grep', 'signed roles see|exact counts and literal|desktop create/edit|held real POST'] : diagnosticRecovery ? ['--grep','held real POST'] : [])], env);
} finally {
  await cleanup();
}
