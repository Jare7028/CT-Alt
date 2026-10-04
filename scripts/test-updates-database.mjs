import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {updatesRaceChecks} from '../tests/database/updates-races.mjs';
const name='ct-alt-updates-'+randomUUID(),image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args,input){const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr);return result;}
const sql=content=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stderr;
function query(content){return docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stdout.trim();}
function asyncSql(content){const child=spawn('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','ct_alt_test']);let stderr='',stdout='';child.stdout.on('data',c=>stdout+=c);child.stderr.on('data',c=>stderr+=c);child.stdin.end(content);return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,stderr,stdout}));});}
async function waitingTransaction(){for(let i=0;i<60;i++){if(query("select count(*) from pg_stat_activity where application_name='ct_alt_updates_race' and wait_event='PgSleep'")==='1')return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Updates race did not reach barrier');}
let started=false;
try{
 docker(['run', '-d', '--label', `ct-alt.test-runner-pid=${process.pid}`,'--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;registerDatabaseFixture(name);
 let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],{stdio:'ignore',timeout:5000}).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}
 if(!ready)throw new Error('Isolated search database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));
  storageFixture = await startDatabaseStorage(name);
 sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 const migrations=new URL('../supabase/migrations/',import.meta.url);for(const filename of readdirSync(migrations).filter(value=>value.endsWith('.sql')).sort())sql(readFileSync(new URL(filename,migrations),'utf8'));
 const checks=sql(readFileSync(new URL('../tests/database/updates.sql',import.meta.url),'utf8')).split('\n').filter(value=>value.includes('PASS:'));
 checks.push(...await updatesRaceChecks({sql,query,asyncSql,waitingTransaction}));
 console.log(checks.join('\n'));console.log(`${checks.length} Updates assertions passed in isolated PostgreSQL17.`);
}finally{ try {storageFixture?.cleanup();} finally {if(started)docker(['rm','-f',name]);}}
