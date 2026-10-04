import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
// Only invoked by the network-none disposable PostgreSQL runner; no URLs/ports.
export async function runKnowledgeRaces({name,query,sql}){
 const tenant='88000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000901',checks=[];
 const session=`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);`;
 const literal=v=>"'"+JSON.stringify(v).replaceAll("'","''")+"'::jsonb";
 const call=(op,change)=>`select public.save_knowledge_base('${tenant}','${op}',${literal(change)});`;
 function asyncSql(command){const child=spawn('docker',['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test']);let out='',err='';child.stdout.on('data',s=>out+=s);child.stderr.on('data',s=>err+=s);child.stdin.end(command);const done=new Promise(resolve=>child.on('close',code=>resolve({code,out,err})));return{done};}
 async function barrier(marker,event){for(let i=0;i<100;i++){if(query(`select count(*)from pg_stat_activity where pid<>pg_backend_pid()and query like '%${marker}%'and wait_event='${event}'`) !== '0')return;await new Promise(r=>setTimeout(r,20));}throw Error(`Missing real ${event} barrier ${marker}`);}
 for(const outcome of ['commit','rollback','denied']){
  const base=randomUUID(),op=randomUUID(),marker='kb_uncommitted_'+outcome;
  sql(`insert into public.knowledge_bases(id,tenant_id,name,description,status)values('${base}','${tenant}','Synthetic uncommitted ${outcome}','','published');insert into public.knowledge_audience(tenant_id,base_id,actor_id,name)values('${tenant}','${base}','${actor}','Synthetic owner');`);
  const writer=asyncSql(`begin;${session}${call(op,{action:'view',baseId:base,revision:1,nodeId:null,nodeRevision:null})}${outcome==='denied'?`reset role;delete from public.knowledge_audience where base_id='${base}';`:''}select pg_sleep(1.5)/*${marker}*/;${outcome==='rollback'?'rollback':'commit'};`);
  await barrier(marker,'PgSleep');
  const reader=asyncSql(`${session}select public.reconcile_knowledge_view('${tenant}','${op}');/*kb_reconcile_${outcome}*/`);
  await barrier('reconcile_knowledge_view','advisory');
  const [w,r]=await Promise.all([writer.done,reader.done]);assert.equal(w.code,0,w.err);
  if(outcome==='denied'){assert.notEqual(r.code,0);assert.match(r.err,/reader access unavailable/i);checks.push('PASS: reconciliation waits genuinely uncommitted view then denies revoked original audience');}
  else{assert.equal(r.code,0,r.err);const dto=JSON.parse(r.out.trim().split('\n').at(-1));assert.equal(dto.status,outcome==='commit'?'recorded':'not_recorded');assert.deepEqual(Object.keys(dto).sort(),['actorId','operationId','role','status','tenantId']);assert.equal(query(`select count(*)from public.knowledge_events where base_id='${base}'`),outcome==='commit'?'1':'0');checks.push(`PASS: reconciliation waits genuinely uncommitted ${outcome} and returns field-free ${dto.status}`);}
 }
 const op=randomUUID(),change={action:'create_base',name:'Parallel UUID create',description:'',audienceIds:[]},marker='kb_parallel_uuid';
 const writer=asyncSql(`begin;${session}${call(op,change)}select pg_sleep(1.5)/*${marker}*/;commit;`);await barrier(marker,'PgSleep');const retry=asyncSql(`${session}${call(op,change)}`);await barrier('save_knowledge_base','advisory');const [w,r]=await Promise.all([writer.done,retry.done]);assert.equal(w.code,0,w.err);assert.equal(r.code,0,r.err);assert.equal(query("select count(*)from public.knowledge_bases where name='Parallel UUID create'"),'1');assert.equal(query("select count(*)from public.knowledge_audit a join public.knowledge_bases b on b.id=a.base_id where b.name='Parallel UUID create'"),'1');checks.push('PASS: parallel same UUID create serializes into one base and audit');
 // Two management writes against the same aggregate revision cannot both commit.
 const base=randomUUID(),folder=randomUUID();sql(`insert into public.knowledge_bases(id,tenant_id,name,description)values('${base}','${tenant}','Concurrent tree','');insert into public.knowledge_nodes(id,tenant_id,base_id,kind,name,description,depth,rank)values('${folder}','${tenant}','${base}','folder','Folder','',1,1024);`);
 const first=asyncSql(`begin;${session}${call(randomUUID(),{action:'archive_node',baseId:base,revision:1,nodeId:folder,nodeRevision:1})}select pg_sleep(1.5)/*kb_parent_archive*/;commit;`);await barrier('kb_parent_archive','PgSleep');const competing=asyncSql(`${session}${call(randomUUID(),{action:'create_node',baseId:base,revision:1,parentId:folder,kind:'text',name:'Late child',description:'',body:'Late'})}`);await barrier('save_knowledge_base','advisory');const [a,b]=await Promise.all([first.done,competing.done]);assert.equal(a.code,0,a.err);assert.notEqual(b.code,0);assert.match(b.err,/Base changed or archived/);assert.equal(query(`select count(*)from public.knowledge_nodes where parent_id='${folder}'`),'0');checks.push('PASS: competing folder archive/create serializes, stale child cannot enter archived subtree');
 // Remove only candidate records, retaining every legacy row/hash unchanged.
 sql('delete from workforce_private.knowledge_operations;delete from public.knowledge_audit;delete from public.knowledge_events;delete from public.knowledge_audience;delete from public.knowledge_nodes;delete from public.knowledge_bases;');
 return checks;
}
