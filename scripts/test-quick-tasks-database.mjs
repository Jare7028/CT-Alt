import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {quickTaskRaceChecks} from '../tests/database/quick-tasks-races.mjs';
const name='ct-alt-quick-tasks-'+randomUUID(),image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args,input){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(r.error||r.status!==0)throw new Error(r.error?.message||r.stderr);return r;}
function sql(content){return docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stderr;}
function query(content){return docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stdout.trim();}
function asyncSql(content){const c=spawn('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','ct_alt_test']);let stderr='',stdout='';c.stdout.on('data',v=>{stdout+=v;});c.stderr.on('data',v=>{stderr+=v;});c.stdin.end(content);return new Promise((resolve,reject)=>{c.on('error',reject);c.on('close',status=>resolve({status,stderr,stdout}));});}
async function waitingTransaction(){for(let i=0;i<60;i++){if(query("select count(*) from pg_stat_activity where application_name='ct_alt_task_race' and wait_event='PgSleep'")==='1')return;await new Promise(r=>setTimeout(r,50));}throw new Error('Task race did not reach barrier');}
let started=false;
try{docker(['run','-d','--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;let ready=false;for(let i=0;i<60;i++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],{stdio:'ignore',timeout:5000}).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,500));}if(!ready)throw new Error('Isolated task database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));const dir=new URL('../supabase/migrations/',import.meta.url);for(const f of readdirSync(dir).filter(f=>f.endsWith('.sql')).sort())sql(readFileSync(new URL(f,dir),'utf8'));
 const checks=sql(readFileSync(new URL('../tests/database/quick-tasks.sql',import.meta.url),'utf8')).split('\n').filter(v=>v.includes('PASS:'));checks.push(...await quickTaskRaceChecks({sql,query,asyncSql,waitingTransaction}));console.log(checks.join('\n'));console.log(`${checks.length} Quick Tasks assertions passed in isolated PostgreSQL17.`);
}finally{if(started)docker(['rm','-f',name]);}
