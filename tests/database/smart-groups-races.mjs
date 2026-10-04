import {spawn} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
export async function runSmartGroupRaces({name,query}){
 const tenant='88000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000901';
 const signed=`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);`;
 const run=statement=>new Promise((resolve,reject)=>{const p=spawn('docker',['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test']);let out='',err='';p.stdout.on('data',b=>out+=b);p.stderr.on('data',b=>err+=b);p.on('error',reject);p.on('close',code=>resolve({code,out,err}));p.stdin.end(statement);});
 const json=out=>JSON.parse(out.trim().split('\n').findLast(s=>s.startsWith('{')));
 const save=change=>`select public.save_smart_group('${tenant}','${randomUUID()}','${JSON.stringify(change)}'::jsonb);`;
 const checks=[];
 const op=randomUUID(),payload={action:'create_segment',name:'Concurrent UUID',description:''};
 const commands=signed+`select public.save_smart_group('${tenant}','${op}','${JSON.stringify(payload)}'::jsonb);`;
 const same=await Promise.all([run(commands),run(commands)]);assert.ok(same.every(r=>r.code===0),JSON.stringify(same));assert.deepEqual(json(same[0].out),json(same[1].out));
 assert.equal(query(`select count(*)from workforce_private.smart_group_operations where operation_id='${op}'`),'1');assert.equal(query(`select count(*)from public.smart_group_audit where segment_id='${json(same[0].out).segmentId}'`),'1');checks.push('PASS: concurrent same UUID has one receipt one audit and identical acknowledgement');
 for(let i=0;i<4;i++){
  const segment=json(query(signed+save({action:'create_segment',name:`Parent race ${i}`,description:''}))).segmentId;
  const archive=signed+save({action:'archive_segment',segmentId:segment,revision:1});
  const create=signed+save({action:'create_group',segmentId:segment,name:'Child',description:'',rules:[{field:'title',values:['Cook']}]});
  const raced=await Promise.all([run(archive),run(create)]);assert.equal(raced.filter(r=>r.code===0).length,1,JSON.stringify(raced));assert.ok(raced.find(r=>r.code!==0).err.includes('Parent archived')||raced.find(r=>r.code!==0).err.includes('Active groups remain'));
  assert.equal(query(`select count(*)from public.smart_groups g join public.smart_group_segments s on s.tenant_id=g.tenant_id and s.id=g.segment_id where g.status='active'and s.status='archived'`),'0');
 }
 checks.push('PASS: parallel parent archive versus group create serializes without active child under archived parent');
 const marker='smart-snapshot-'+randomUUID(),before=json(query(signed+`select public.read_smart_groups('${tenant}','preview',null,null,'all','',50,null,'[{"field":"title","values":["Cook"]}]');`));
 const held=run(`set application_name='${marker}';`+signed+`select public.read_smart_groups('${tenant}','preview',null,null,'all','',50,null,'[{"field":"title","values":["Cook"]}]')from(select pg_sleep(2))barrier;`);
 let barrier=false;for(let i=0;i<100;i++){if(query(`select count(*)from pg_stat_activity where application_name='${marker}'and wait_event='PgSleep'`)==='1'){barrier=true;break;}await new Promise(r=>setTimeout(r,20));}assert.ok(barrier,'Snapshot barrier reached');
 try{query("update public.agents set title='Other'where id='77000000-0000-4000-8000-000000000001'");const result=await held;assert.equal(result.code,0,result.err);const snapshot=json(result.out);assert.equal(snapshot.counts.records,before.counts.records);assert.equal(snapshot.datasetVersion,before.datasetVersion);const fresh=json(query(signed+`select public.read_smart_groups_access('${tenant}');`));assert.notEqual(fresh.datasetVersion,snapshot.datasetVersion);checks.push('PASS: held STABLE preview retains coherent prior population and fresh read detects profile change');}
 finally{await held;query("update public.agents set title='Cook'where id='77000000-0000-4000-8000-000000000001'");}
 return checks;
}
