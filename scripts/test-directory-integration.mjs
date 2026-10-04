import {verifyDirectoryBaselines} from './knowledge-base-files-readiness.mjs';
verifyDirectoryBaselines();
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const mode=process.argv[2]??'directory';
const suites={directory:'directory.spec.ts',capture:'directory.spec.ts','retained-rotas':'rotas.spec.ts','retained-templates':'rota-templates.spec.ts','retained-publication':'rota-publication.spec.ts','retained-requests':'requests.spec.ts','retained-agents':['agents.spec.ts','agents-api.spec.ts']};
if(process.argv.length>3||!Object.hasOwn(suites,mode))throw Error('Only the full Directory suite, its existing desktop capture case or one fresh retained suite is supported.');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (realpathSync(process.cwd()) !== realpathSync(root) || JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).name !== 'ct-alt') throw Error('Run only from this independent CT Alt repository.');
const remote = spawnSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' });
if (remote.status !== 0 || !/^(https:\/\/github\.com\/|git@github\.com:)Jare7028\/CT-Alt(?:\.git)?$/i.test(remote.stdout.trim())) throw Error('Refusing an unverified repository binding.');
const fixtureEnv={...process.env};
delete fixtureEnv.CT_ALT_KB_FILE_HMAC_KEY;
delete fixtureEnv.CT_ALT_KB_FILE_HMAC_KEY_ID;
delete fixtureEnv.CT_ALT_DIRECTORY_CAPTURE;
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
    child.on('exit', code => code === 0 ? resolve() : reject(Error('Directory acceptance command failed.')));
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
  for (const port of [5180, 54821, 54824, 54825, 54826, 54827]) await new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', () => reject(Error(`Owned fixture port ${port} is busy.`)));
    probe.listen(port, '127.0.0.1', () => probe.close(resolve));
  });
  fixture = spawn(process.execPath, ['scripts/overview-browser-fixture.mjs'], { cwd: root, stdio: 'inherit', env:fixtureEnv });
  let ready = false;
  for (let i = 0; i < 360; i++) {
    if (fixture.exitCode !== null || fixture.signalCode !== null) throw Error('Owned fixture failed to start.');
    if (existsSync(fixtures)) { ready = true; break; }
    await delay(250);
  }
  if (!ready) throw Error('Owned fixture startup timed out.');
  const settings = JSON.parse(readFileSync(fixtures, 'utf8'));
  if (settings.url !== 'http://127.0.0.1:54821' || !/^[0-9a-f]{8}$/.test(settings.fixtureLabel) || typeof settings.key !== 'string' || settings.tenantA!=='40000000-0000-4000-8000-000000000001' || settings.tenantB!=='40000000-0000-4000-8000-000000000002') throw Error('Wrong owned fixture settings.');
  if(mode==='retained-rotas'){
    const owned=spawnSync('docker',['inspect','supabase_db_ct-alt-independent','--format','{{index .Config.Labels "ct-alt.test"}}'],{encoding:'utf8',timeout:10000});
    if(owned.status!==0||owned.stdout.trim()!==settings.fixtureLabel)throw Error('Owned retained Rotas identity mismatch');
    // Canonical ephemeral legacy-zone seed, exactly as the released retained runner.
    // Restore both production guards in the same isolated local transaction.
    const seed=spawnSync('docker',['exec','-i','supabase_db_ct-alt-independent','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{encoding:'utf8',timeout:10000,input:"begin;alter table public.rota_schedules disable trigger rota_supported_time_zone;alter table public.rota_schedules disable trigger rota_time_zone;insert into public.rota_schedules(id,tenant_id,name,time_zone) values('ac100000-0000-4000-8000-000000000001','"+settings.tenantA+"','Synthetic legacy unsupported zone','Factory');alter table public.rota_schedules enable trigger rota_supported_time_zone;alter table public.rota_schedules enable trigger rota_time_zone;commit;"});
    if(seed.error||seed.status!==0)throw Error('Owned retained Rotas seed failed: '+(seed.error?.message||seed.stderr));
  }
  const configPath = `/tmp/ct-alt-directory-auth-${settings.fixtureLabel}.config.mjs`;
  // This dedicated test is outside the shared tests/browser configuration.
  writeFileSync(configPath, `export default {...${JSON.stringify({testDir:resolve(root,'tests/browser'),testMatch:suites[mode],workers:1,retries:0,outputDir:resolve(root,'test-results'),use:{baseURL:'http://127.0.0.1:5180',headless:true,viewport:{width:1444,height:960},launchOptions:{executablePath:process.env.CT_ALT_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']}}})}${mode==='capture'?',grep:/genuine desktop activation create catalog search and visibility reflect authoritative Work Contacts/':''}};\n`,{mode:0o600,flag:'wx'});
  config = configPath;
  const syntax = spawnSync(process.execPath, ['--check', configPath], { cwd: root, encoding: 'utf8' });
  if (syntax.error || syntax.status !== 0) throw Error('Generated Directory browser configuration is invalid: ' + (syntax.error?.message || syntax.stderr));
  const env = { ...fixtureEnv, NEXT_PUBLIC_SUPABASE_URL: settings.url, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: settings.key, NEXT_TELEMETRY_DISABLED: '1' };
  await run(['node_modules/next/dist/bin/next', 'build'], env);
  server = spawn(process.execPath, ['node_modules/next/dist/bin/next', 'start', '--hostname', '127.0.0.1', '--port', '5180'], { cwd: root, stdio: 'inherit', env });
  ready = false;
  for (let i = 0; i < 40; i++) {
    if (server.exitCode !== null || server.signalCode !== null) throw Error('Owned application failed to start.');
    try { if ((await fetch('http://127.0.0.1:5180/login')).ok) { ready = true; break; } } catch {}
    await delay(250);
  }
  if (!ready) throw Error('Owned application startup timed out.');
  await run(['node_modules/@playwright/test/cli.js', 'test', '--config', config], {...env,...(['directory','capture'].includes(mode)?{CT_ALT_DIRECTORY_CAPTURE:'1'}:{})});
} finally {
  await cleanup();
}
