// Genuine pinned local Storage provider. Never accepts hosted database URLs.
import { spawnSync } from 'node:child_process';
import { randomUUID, randomBytes, createHmac } from 'node:crypto';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
export const STORAGE_IMAGE = 'supabase/storage-api@sha256:13cdccea43f23d848f050eba0d4f3ccdf02a7aca93d4f43268438de95549ef74';
export async function startOwnedStorage({ dbContainer, dbName, fixtureLabel, jwtSecret, anonKey, serviceKey, postgrestUrl = 'http://unused-rest:3000', networkName, publishPort, onCleanupReady } = {}) {
  if (!/^[-a-zA-Z0-9_]+$/.test(dbContainer ?? '') || !/^[-a-zA-Z0-9_]+$/.test(dbName ?? '') || !fixtureLabel?.key || !fixtureLabel?.value) throw Error('Verified local database identity required');
  if (!['ct-alt.test', 'ct-alt.test-runner-pid'].includes(fixtureLabel.key) || !/^[a-zA-Z0-9-]+$/.test(String(fixtureLabel.value))) throw Error('Unsupported fixture label');
  if (publishPort !== undefined && publishPort !== 54827) throw Error('Only the reserved loopback Storage fixture port is permitted');
  const nonce = randomUUID(), labelKey = 'ct-alt.storage-fixture', network = networkName ?? `ct-alt-storage-${nonce}`, containerName = `ct-alt-storage-${nonce}-api`, dir = `/tmp/ct-alt-storage-${nonce}`;
  if (!/^ct-alt-[-a-zA-Z0-9_]+$/.test(network)) throw Error('Invalid local fixture network');
  const password = randomBytes(24).toString('hex');
  jwtSecret ??= randomBytes(48).toString('hex');
  const token = role => { const p = x => Buffer.from(JSON.stringify(x)).toString('base64url'); const text = p({alg:'HS256',typ:'JWT'})+'.'+p({role,iat:Math.floor(Date.now()/1000),exp:Math.floor(Date.now()/1000)+86400}); return text+'.'+createHmac('sha256',jwtSecret).update(text).digest('base64url'); };
  anonKey ??= token('anon'); serviceKey ??= token('service_role');
  const redact = text => [jwtSecret,password,anonKey,serviceKey].reduce((s,v)=>s.replaceAll(v,'[synthetic-private-value]'),String(text)).replace(/postgres:\/\/[^\s"']+/g,'[local-private-dsn]');
  const docker = (args,input,allowFailure=false) => { const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024}); if (!allowFailure && (r.error || r.status!==0)) throw Error(redact(r.error?.message || r.stderr || r.stdout || 'Docker failed')); return r; };
  const inspect = name => JSON.parse(docker(['inspect',name]).stdout)[0];
  const verifyDb = () => { const info=inspect(dbContainer); if(info.Config.Labels?.[fixtureLabel.key]!==String(fixtureLabel.value) || !info.State.Running || info.Config.Image!=='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24') throw Error('Local PostgreSQL fixture identity mismatch'); };
  const query = sql => { verifyDb(); return docker(['exec','-i',dbContainer,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d',dbName],sql).stdout.trim(); };
  let ownNetwork=false,attached=false,provider=false,cleaned=false,detachedNone=false;
  const verifyOwned = name => { if(inspect(name).Config.Labels?.[labelKey]!==nonce) throw Error('Storage provider ownership mismatch'); };
  function cleanup() {
    if(cleaned)return;
    const errors=[];
    if(provider){try{verifyOwned(containerName);docker(['rm','-f',containerName]);provider=false;}catch(e){errors.push(e);}}
    if(attached){try{
      const found=docker(['inspect',dbContainer],undefined,true);
      if(found.status===0){verifyDb();docker(['network','disconnect',network,dbContainer]);}
      attached=false;
    }catch(e){errors.push(e);}}
    if(detachedNone && !attached){try{const found=docker(['inspect',dbContainer],undefined,true);if(found.status===0){verifyDb();docker(['network','connect','none',dbContainer]);}detachedNone=false;}catch(e){errors.push(e);}}
    if(ownNetwork && !provider && !attached){try{const n=JSON.parse(docker(['network','inspect',network]).stdout)[0];if(n.Labels?.[labelKey]!==nonce)throw Error('Storage network ownership mismatch');docker(['network','rm',network]);ownNetwork=false;}catch(e){errors.push(e);}}
    try{rmSync(dir,{recursive:true,force:true});}catch(e){errors.push(e);}
    cleaned=!provider&&!attached&&!ownNetwork&&!detachedNone&&!errors.length;
    if(errors.length)throw new AggregateError(errors,'Owned Storage cleanup incomplete; retry cleanup');
  }
  onCleanupReady?.(cleanup);
  try {
    verifyDb();
    if(networkName){const n=JSON.parse(docker(['network','inspect',network]).stdout)[0];if(n.Labels?.[fixtureLabel.key]!==String(fixtureLabel.value))throw Error('Existing fixture network identity mismatch');}
    else {docker(['network','create','--internal','--label',`${labelKey}=${nonce}`,network]);ownNetwork=true;}
    const dbNetworks=inspect(dbContainer).NetworkSettings.Networks;
    if(!dbNetworks[network]){if(dbNetworks.none){docker(['network','disconnect','none',dbContainer]);detachedNone=true;}docker(['network','connect','--alias','postgres',network,dbContainer]);attached=true;}
    const host = attached ? 'postgres' : dbContainer;
    query(`create role supabase_storage_admin noinherit login bypassrls password '${password}';grant anon,authenticated,service_role to supabase_storage_admin;grant create on database "${dbName}" to supabase_storage_admin;create schema storage authorization supabase_storage_admin;grant usage on schema storage to anon,authenticated,service_role;alter default privileges for role supabase_storage_admin in schema storage grant all on tables to anon,authenticated,service_role;alter default privileges for role supabase_storage_admin in schema storage grant all on functions to anon,authenticated,service_role;alter default privileges for role supabase_storage_admin in schema storage grant all on sequences to anon,authenticated,service_role;`);
    mkdirSync(dir,{mode:0o700});
    const env={ANON_KEY:anonKey,SERVICE_KEY:serviceKey,AUTH_JWT_SECRET:jwtSecret,DATABASE_URL:`postgres://supabase_storage_admin:${password}@${host}:5432/${dbName}`,DB_SUPER_USER:'supabase_storage_admin',DB_INSTALL_ROLES:'false',DB_MIGRATIONS_STRATEGY:'on_request',DB_ALLOW_MIGRATION_REFRESH:'false',POSTGREST_URL:postgrestUrl,STORAGE_BACKEND:'file',FILE_STORAGE_BACKEND_PATH:'/var/lib/storage',GLOBAL_S3_BUCKET:'synthetic-files',TENANT_ID:'synthetic-local',REGION:'local',FILE_SIZE_LIMIT:'52428800',ENABLE_IMAGE_TRANSFORMATION:'false',S3_PROTOCOL_ENABLED:'false',PG_QUEUE_ENABLE:'false',VECTOR_STORE_MIGRATIONS_ENABLED:'false',LOG_LEVEL:'warn'};
    if(Object.values(env).some(v=>/[\r\n\0]/.test(v)))throw Error('Invalid private provider environment');
    writeFileSync(dir+'/provider.env',Object.entries(env).map(([k,v])=>`${k}=${v}`).join('\n')+'\n',{mode:0o600,flag:'wx'});
    docker(['run','-d','--name',containerName,'--label',`${labelKey}=${nonce}`,'--network',network,'--tmpfs','/var/lib/storage:rw,mode=1777','--env-file',dir+'/provider.env',...(publishPort ? ['-p',`127.0.0.1:${publishPort}:5000`] : []),STORAGE_IMAGE]);provider=true;
    let healthy=false;
    for(let i=0;i<100;i++){verifyOwned(containerName);if(docker(['exec',containerName,'node','-e',"fetch('http://127.0.0.1:5000/status').then(r=>process.exit(r.status===200?0:1)).catch(()=>process.exit(1))"],undefined,true).status===0){healthy=true;break;}if(!inspect(containerName).State.Running)break;await new Promise(r=>setTimeout(r,200));}
    if(!healthy)throw Error(redact(docker(['logs','--tail','40',containerName],undefined,true).stdout+docker(['logs','--tail','40',containerName],undefined,true).stderr));
    if(query('select count(*) from storage.migrations;')!=='74')throw Error('Pinned provider migration count mismatch');
    if(query("select to_regprocedure('storage.allow_only_operation(text)') is not null;")!=='t')throw Error('Provider operation-aware authorization missing');
    return {containerName,networkName:network,baseUrl:publishPort?`http://127.0.0.1:${publishPort}`:null,query,cleanup,verify:()=>{verifyDb();verifyOwned(containerName);}};
  } catch(error) {await cleanup();throw error;}
}
