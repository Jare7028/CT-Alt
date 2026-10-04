import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {timeOffRaceChecks} from '../tests/database/time-off-races.mjs';
const name='ct-alt-time-off-'+randomUUID(),image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr);return r;}
const sql=content=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stderr;
const query=content=>docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stdout.trim();
function asyncSql(content){const child=spawn('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','ct_alt_test']);let stdout='',stderr='';child.stdout.on('data',v=>{stdout+=v;});child.stderr.on('data',v=>{stderr+=v;});child.stdin.end(content);return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,stdout,stderr}));});}
async function waitingTransaction(){for(let i=0;i<60;i++){if(query("select count(*) from pg_stat_activity where application_name='ct_alt_leave_race' and wait_event='PgSleep'")==='1')return;await new Promise(r=>setTimeout(r,50));}throw new Error('Time off race did not reach barrier');}
let started=false;
try{
 docker(['run', '-d', '--label', `ct-alt.test-runner-pid=${process.pid}`,'--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;registerDatabaseFixture(name);let ready=false;
 for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],{stdio:'ignore',timeout:5000}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Isolated leave database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));
  storageFixture = await startDatabaseStorage(name);
 // Match hosted public-schema default function ACLs, including service_role.
 sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');
 const dir=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sql(readFileSync(new URL(file,dir),'utf8'));
 const checks=sql(readFileSync(new URL('../tests/database/time-off.sql',import.meta.url),'utf8')).split('\n').filter(v=>v.includes('PASS:'));checks.push(...await timeOffRaceChecks({sql,query,asyncSql,waitingTransaction}));console.log(checks.join('\n'));console.log(`${checks.length} Time Off assertions passed in isolated PostgreSQL17.`);
}finally{ try {storageFixture?.cleanup();} finally {if(started)docker(['rm','-f',name]);}}
