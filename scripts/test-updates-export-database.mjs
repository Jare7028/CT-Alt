import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
const name='ct-alt-updates-export-'+randomUUID(),image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr);return r;}
const sql=c=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],c).stderr;
const query=c=>docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],c).stdout.trim();
const functions="select coalesce(jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig)order by p.oid),'[]')from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workforce_private','chat_private')and p.proname<>'read_update_recipients_export'";
function tableData(){return query("select schemaname||'.'||tablename from pg_tables where schemaname in('public','workforce_private','chat_private')order by 1").split('\n').map(t=>{if(!/^(public|workforce_private|chat_private)\.[a-z_]+$/.test(t))throw Error('Unexpected test table');return [t,query(`select count(*)||':'||coalesce(md5(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text)),'empty')from ${t} t`)];});}
let started=false;
try{docker(['run', '-d', '--label', `ct-alt.test-runner-pid=${process.pid}`,'--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;registerDatabaseFixture(name);let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],{stdio:'ignore'}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}if(!ready)throw Error('Disposable export database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));
  storageFixture = await startDatabaseStorage(name);sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort(),candidate=files.filter(f=>f.endsWith('_updates_engagement_export.sql'));if(candidate.length!==1)throw Error('Expected one unapplied export candidate');for(const f of files.filter(f=>!candidate.includes(f)))sql(readFileSync(new URL(f,dir),'utf8'));
 sql(readFileSync(new URL('../tests/database/updates-export-fixture.sql',import.meta.url),'utf8'));const beforeFunctions=query(functions),beforeData=JSON.stringify(tableData());
 sql(readFileSync(new URL(candidate[0],dir),'utf8'));if(beforeFunctions!==query(functions)||beforeData!==JSON.stringify(tableData()))throw Error('Additive export changed populated baseline');
 const checks=sql(readFileSync(new URL('../tests/database/updates-export.sql',import.meta.url),'utf8')).split('\n').filter(s=>s.includes('PASS:'));if(beforeFunctions!==query(functions)||beforeData!==JSON.stringify(tableData()))throw Error('Read-only export/tests changed legacy functions or public/private data');
 checks.push('PASS: populated legacy table data and function definitions/owners/ACL/config preserved','PASS: exports do not change view marks, comments, audit or receipt data');console.log(checks.join('\n'));console.log(`${checks.length} Updates export assertions passed in isolated PostgreSQL17.`);
}finally{ try {storageFixture?.cleanup();} finally {if(started)docker(['rm','-f',name]);}}
