import assert from 'node:assert/strict';
const t='91000000-0000-4000-8000-000000000001',s='92000000-0000-4000-8000-000000000001';
const owner='00000000-0000-4000-8000-000000970901',manager='00000000-0000-4000-8000-000000970903',worker='00000000-0000-4000-8000-000000970904';
const one='95000000-0000-4000-8000-000000000001',two='95000000-0000-4000-8000-000000000002';
const signed=(actor=owner)=>`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);`;
export async function rotaPublicationRaceChecks({sql,query,asyncSql}) {
 const base=()=>Number(query(`select revision from public.rota_schedules where id='${s}'`));
 const row=id=>({id,revision:Number(query(`select revision from public.rota_shifts where id='${id}'`))});
 const publish=(revision,rows)=>`select public.publish_rota_shifts('${t}','${s}',${revision},'${JSON.stringify(rows)}');`;
 const reset=()=>sql(`update public.rota_shifts set status='draft',published_at=null,revision=1 where tenant_id='${t}';update public.rota_schedules set revision=1,status='active' where id='${s}';delete from public.rota_audit where tenant_id='${t}';`);
 async function reached(name,event){for(let i=0;i<100;i++){if(query(`select count(*) from pg_stat_activity where application_name='${name}' and ${event}`)==='1')return;await new Promise(r=>setTimeout(r,30));}throw Error('Publication race did not reach '+name);}
 async function pair(name,writerSql,waiterSql,expected){
  const first=asyncSql(`set application_name='publication_${name}_first';${writerSql}`);
  await reached(`publication_${name}_first`,"wait_event='PgSleep'");
  const second=asyncSql(`set application_name='publication_${name}_second';${waiterSql}`);
  await reached(`publication_${name}_second`,"wait_event_type='Lock'");
  const [a,b]=await Promise.all([first,second]);assert.equal(a.status,0,a.stderr);assert.equal(b.status,expected?3:0,b.stderr);if(expected)assert.match(b.stderr,new RegExp(expected));
 }
 const untouched=()=>{assert.equal(query(`select count(*) from public.rota_shifts where tenant_id='${t}' and status='published'`),'0');assert.equal(query(`select count(*) from public.rota_audit where tenant_id='${t}'`),'0');assert.equal(base(),1);};
 for(const commit of[true,false]){
  reset();const rev=base(),r1=[row(one)],r2=[row(two)],name=commit?'commit':'rollback';
  await pair(name,`begin;${signed()}${publish(rev,r1)}select pg_sleep(1.5);${commit?'commit':'rollback'};`,signed()+publish(rev,r2),commit?'40001':null);
  assert.equal(query(`select status from public.rota_shifts where id='${one}'`),commit?'published':'draft');assert.equal(query(`select status from public.rota_shifts where id='${two}'`),commit?'draft':'published');assert.equal(base(),2);assert.equal(query(`select count(*) from public.rota_audit where tenant_id='${t}'`),'1');console.log(`PASS: publication genuine ${name} serializes independent subset with one schedule/audit change`);
 }
 reset();let rev=base(),rows=[row(one),row(two)];
 const legacyEdit={action:'save_shift',schedule_id:s,revision:rev,id:one,agent_id:'93000000-0000-4000-8000-000000000001',job_id:'94000000-0000-4000-8000-000000000001',starts_at:'2026-10-24T22:00:00Z',ends_at:'2026-10-25T07:00:00Z',title:'Legacy race edited',allow_overlap:false};
 await pair('legacy_edit',`begin;${signed()}select public.save_rota('${t}','${JSON.stringify(legacyEdit)}');select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'40001');assert.equal(query(`select count(*) from public.rota_shifts where tenant_id='${t}' and status='published'`),'0');assert.equal(query(`select revision from public.rota_shifts where id='${one}'`),'2');console.log('PASS: legacy edit fences queued subset without partial publication');
 reset();rev=base();rows=[row(one)];
 await pair('legacy_publish',`begin;${signed()}select public.save_rota('${t}','{"action":"publish","schedule_id":"${s}","revision":${rev}}');select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'40001');assert.equal(query(`select count(*) from public.rota_shifts where schedule_id='${s}' and status='published'`),'3');assert.equal(query(`select count(*) from public.rota_audit where tenant_id='${t}'`),'1');console.log('PASS: legacy whole-schedule publish remains atomic and fences new subset');
 reset();rev=base();rows=[row(one),row(two)];
 await pair('grant',`begin;select 1 from public.tenants where id='${t}' for update;delete from public.rota_admins where schedule_id='${s}' and user_id='${manager}';select pg_sleep(1.5);commit;`,signed(manager)+publish(rev,rows),'42501');untouched();sql(`insert into public.rota_admins values('${t}','${s}','${manager}')`);console.log('PASS: post-mutex delegation revocation rejects entire queued subset');
 await pair('worker',`begin;select 1 from public.tenants where id='${t}' for update;update public.tenant_memberships set status='suspended' where tenant_id='${t}' and user_id='${worker}';select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'23503');untouched();sql(`update public.tenant_memberships set status='active' where tenant_id='${t}' and user_id='${worker}'`);console.log('PASS: post-mutex linked-worker suspension rejects all targets without audit');
 await pair('archive',`begin;select 1 from public.tenants where id='${t}' for update;update public.rota_schedules set status='archived' where id='${s}';select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'22023');untouched();sql(`update public.rota_schedules set status='active' where id='${s}'`);console.log('PASS: queued publication rechecks current archival state');
 const confirmation=query(`select email_confirmed_at from auth.users where id='${owner}'`);
 await pair('confirmation',`begin;select 1 from public.tenants where id='${t}' for update;update auth.users set email_confirmed_at=null where id='${owner}';select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'42501');untouched();sql(`update auth.users set email_confirmed_at='${confirmation}' where id='${owner}'`);console.log('PASS: current Auth confirmation revocation fences queued publication');
 // Single-shift template apply is a separately released writer on the same mutex.
 reset();const create={action:'create',schedule_id:s,schedule_revision:base(),name:'Publication race template',title:'Template race draft',job_id:'94000000-0000-4000-8000-000000000001',start_minute:480,end_minute:960,end_day_offset:0};
 sql(`${signed()}select public.save_rota_template('${t}','96000000-0000-4000-8000-000000000001','${JSON.stringify(create)}');reset role;`);
 const tid=query(`select id from public.rota_shift_templates where tenant_id='${t}' and name='Publication race template'`),tr=Number(query(`select revision from public.rota_shift_templates where id='${tid}'`));rev=base();rows=[row(one),row(two)];
 const apply={action:'apply',schedule_id:s,schedule_revision:rev,template_id:tid,template_revision:tr,agent_id:'93000000-0000-4000-8000-000000000001',date:'2026-12-02',start_occurrence:'',end_occurrence:'',allow_overlap:false};
 await pair('template_apply',`begin;${signed()}select public.save_rota_template('${t}','96000000-0000-4000-8000-000000000002','${JSON.stringify(apply)}');select pg_sleep(1.5);commit;`,signed()+publish(rev,rows),'40001');assert.equal(query(`select count(*) from public.rota_shifts where schedule_id='${s}' and status='published'`),'0');assert.equal(query(`select count(*) from public.rota_shifts where schedule_id='${s}' and title='Template race draft'`),'1');console.log('PASS: genuine template application fences stale subset and retains its private draft');
}
