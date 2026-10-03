const tenant='61000000-0000-0000-0000-000000000001';
const auth=n=>`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(n).padStart(12,'0')}',false);`;
const action=(op,id=1,revision=1)=>`select public.save_quick_task('${tenant}','72000000-0000-0000-0000-${String(id).padStart(12,'0')}',jsonb_build_object('action','${op}','taskId',(select id from public.quick_tasks where title='Race'),'revision',${revision}));`;
export async function quickTaskRaceChecks({sql,query,asyncSql,waitingTransaction}){
 const out=[];async function pair(a,b,expected,label){const first=asyncSql("set application_name='ct_alt_task_race';begin;"+a+'select pg_sleep(1.5);commit;');await waitingTransaction();const second=asyncSql(b);const r=await Promise.all([first,second]);if(r[0].status!==0||r[1].status!==(expected?3:0)||expected&&!r[1].stderr.includes(expected))throw new Error(label+JSON.stringify(r));out.push('PASS: '+label);}
 sql(`insert into public.quick_tasks(id,tenant_id,title,description,mode,publication,created_by,batch_id) values('82000000-0000-0000-0000-000000000001','${tenant}','Race','','group','published','00000000-0000-0000-0000-000000000401',gen_random_uuid());insert into public.quick_task_assignees select '${tenant}','82000000-0000-0000-0000-000000000001',id,'Synthetic 404' from public.agents where phone='+447700900404';`);
 await pair(auth(404)+action('complete'),auth(404)+action('complete'),null,'same completion UUID adds one audit and returns stable acknowledgement');
 if(query("select count(*) from public.quick_task_audit where operation_id='72000000-0000-0000-0000-000000000001'")!=='1')throw new Error('Duplicate completion audit');
 sql(auth(401)+action('reopen',2,2));
 await pair(auth(404)+action('complete',3,3),auth(401)+action('archive',4,3),'40001','completion versus archive serializes and rejects stale revision');
 sql(auth(401)+action('reopen',5,4));
 await pair(`update public.tenant_memberships set status='suspended' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000404';`,auth(404)+action('complete',6,5),'42501','membership suspension rejects queued completion');
 sql(`update public.tenant_memberships set status='active' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000404';`);
 await pair("update public.agents set status='archived' where phone='+447700900404';",auth(404)+action('complete',7,5),'42501','agent archive rejects queued completion');
 sql("update public.agents set status='active' where phone='+447700900404';");
 await pair(`update public.tenants set status='suspended' where id='${tenant}';`,auth(404)+action('complete',8,5),'42501','company suspension rejects queued completion');
 sql(`update public.tenants set status='active' where id='${tenant}';`);
 if(query("select status from public.quick_tasks where title='Race'")!=='open')throw new Error('Denied races changed task state');out.push('PASS: denied races preserve open task state');return out;
}
