import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import {spawn,spawnSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {timeClockRaceChecks} from '../tests/database/time-clock-races.mjs';
// Each run owns a random, unpublished, network-disabled local PostgreSQL.
const name='ct-alt-time-clock-'+randomUUID();
const image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';
function docker(args,input){const result=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000});if(result.error||result.status!==0)throw new Error(result.error?.message||result.stderr);return result;}
function sql(content){return docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stderr;}
function query(content){return docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],content).stdout.trim();}
function asyncSql(content){const child=spawn('docker',['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','ct_alt_test']);let stderr='',stdout='';child.stdout.on('data',chunk=>{stdout+=chunk;});child.stderr.on('data',chunk=>{stderr+=chunk;});child.stdin.end(content);return new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',status=>resolve({status,stderr,stdout}));});}
async function waitingTransaction(){for(let attempt=0;attempt<60;attempt++){if(query("select count(*) from pg_stat_activity where application_name='ct_alt_clock_race' and wait_event='PgSleep'")==='1')return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Time Clock race did not reach barrier');}
let started=false;
try{
 docker(['run', '-d', '--label', `ct-alt.test-runner-pid=${process.pid}`,'--name',name,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;registerDatabaseFixture(name);
 let ready=false;for(let attempt=0;attempt<60;attempt++){if(spawnSync('docker',['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],{stdio:'ignore',timeout:5000}).status===0){ready=true;break;}await new Promise(resolve=>setTimeout(resolve,500));}if(!ready)throw new Error('Local clock database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));
  storageFixture = await startDatabaseStorage(name);
 const directory=new URL('../supabase/migrations/',import.meta.url);for(const file of readdirSync(directory).filter(file=>file.endsWith('.sql')).sort())sql(readFileSync(new URL(file,directory),'utf8'));
 const checks=sql(readFileSync(new URL('../tests/database/time-clock.sql',import.meta.url),'utf8')).split('\n').filter(line=>line.includes('PASS:'));
 checks.push(...await timeClockRaceChecks({sql,query,asyncSql,waitingTransaction}));
 console.log(checks.join('\n'));console.log(`${checks.length} Time Clock database assertions passed in isolated PostgreSQL 17.`);
}finally{ try {storageFixture?.cleanup();} finally {if(started)docker(['rm','-f',name]);}}
