const tenant='60000000-0000-0000-0000-000000000001';
const identity=n=>`set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(n).padStart(12,'0')}',false);`;
const op=(id,action,extra)=>`select public.save_time_clock('${tenant}','90000000-0000-0000-0000-${String(id).padStart(12,'0')}',jsonb_build_object('action','${action}')||${extra});`;
const job=name=>`jsonb_build_object('jobId',(select id from public.time_clock_jobs where name='${name}'))`;
const current=revision=>`jsonb_build_object('entryId',(select id from public.time_clock_entries where tenant_id='${tenant}' and agent_id=(select id from public.agents where phone='+447700900304') and ended_at is null),'revision',${revision})`;
export async function timeClockRaceChecks({sql,query,asyncSql,waitingTransaction}){
 const messages=[];
 async function pair(firstSql,secondSql,expected,label){
  const first=asyncSql("set application_name='ct_alt_clock_race';begin;"+firstSql+'select pg_sleep(1.5);commit;');
  await waitingTransaction();const second=asyncSql(secondSql);const results=await Promise.all([first,second]);
  if(results[0].status!==0||results[1].status!==(expected?3:0)||expected&&!results[1].stderr.includes(expected))throw new Error(label+': '+JSON.stringify(results));
  messages.push('PASS: '+label);return results;
 }
 const clockIn=identity(304)+op(1,'clock_in',job('Race'));
 await pair(clockIn,clockIn,null,'simultaneous same-operation clock-ins return one durable result');
 if(query(`select count(*) from public.time_clock_entries where tenant_id='${tenant}' and ended_at is null`)!=='1')throw new Error('Same operation duplicated open entry');
 if(query(`select count(*) from public.time_clock_audit where operation_id='90000000-0000-0000-0000-000000000001'`)!=='1')throw new Error('Same operation duplicated audit');
 messages.push('PASS: concurrent replay adds exactly one entry and audit');
 sql(identity(304)+op(2,'clock_out',current(1)));
 await pair(identity(304)+op(3,'clock_in',job('Race')),identity(304)+op(4,'clock_in',job('Race')),'40001','distinct simultaneous clock-ins cannot overlap');
 await pair(identity(304)+op(5,'break_start',current(1)+"||'{\"paid\":false}'::jsonb"),identity(304)+op(6,'break_start',current(1)+"||'{\"paid\":true}'::jsonb"),'40001','simultaneous paid/unpaid breaks serialize and reject stale revision');
 await pair(identity(304)+op(7,'break_end',current(2)),identity(304)+op(8,'clock_out',current(2)),'40001','break-end and clock-out serialize against the same entry revision');
 sql(identity(304)+op(9,'clock_out',current(3)));
 await pair(identity(301)+op(10,'archive_job',job('Archive race')+"||'{\"revision\":1}'::jsonb"),identity(304)+op(11,'clock_in',job('Archive race')),'40001','job archive queued before clock-in rejects the newly archived job');
 // A membership lock changed by an external workforce action is rechecked
 // when the queued save obtains FOR SHARE; old Auth identity cannot suffice.
 await pair(`update public.tenant_memberships set status='suspended' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000304';`,identity(304)+op(12,'clock_in',job('Race')),'42501','concurrent membership suspension denies queued clock action');
 sql(`update public.tenant_memberships set status='active' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000304';`);
 await pair("update public.agents set status='archived' where phone='+447700900304';",identity(304)+op(13,'clock_in',job('Race')),'42501','concurrent agent archive denies queued clock action');
 sql("update public.agents set status='active' where phone='+447700900304';");
 await pair(`update public.tenants set status='suspended' where id='${tenant}';`,identity(304)+op(14,'clock_in',job('Race')),'42501','company suspension denies queued clock action');
 sql(`update public.tenants set status='active' where id='${tenant}';`);
 await pair(`update public.tenant_memberships set role='manager' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000301';`,identity(301)+op(10,'archive_job',job('Archive race')+"||'{\"revision\":1}'::jsonb"),'42501','role revocation denies even committed job-operation replay');
 sql(`update public.tenant_memberships set role='owner' where tenant_id='${tenant}' and user_id='00000000-0000-0000-0000-000000000301';`);
 if(query(`select count(*) from public.time_clock_entries where tenant_id='${tenant}' and ended_at is null`)!=='0')throw new Error('Rejected races left an open entry');
 messages.push('PASS: rejected races leave no open clock entry');
 return messages;
}
