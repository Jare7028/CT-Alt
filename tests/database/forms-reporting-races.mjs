import {spawn} from 'node:child_process';
const tenant='88000000-0000-4000-8000-000000000001',actor='00000000-0000-4000-8000-000000000901',form='6e900000-0000-4000-8000-000000000001';
const signed=`set role authenticated;select set_config('request.jwt.claim.sub','${actor}',false);`;
export async function runFormsReportingRaces({name,query,sql}) {
  const results=[];
  const pending=command=>new Promise((resolve,reject)=>{
    const child=spawn('docker',['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test']);let out='',err='';
    child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>err+=b);child.on('error',reject);
    child.on('close',code=>code===0?resolve(out.trim().split('\n').at(-1)):reject(Error(err)));child.stdin.end(command);
  });
  const wait=async()=>{for(let i=0;i<100;i++){if(query("select count(*)from pg_stat_activity where wait_event='PgSleep' and query like '%report_snapshot_gate%'and pid<>pg_backend_pid()")!=='0')return;await new Promise(r=>setTimeout(r,20));}throw Error('Reporting race did not reach owned snapshot barrier');};
  try {
    sql(`insert into public.forms(id,tenant_id,name,description,schema,schema_frozen,status)values('${form}','${tenant}','Race reporting original','','[{"id":"6e900000-0000-4000-8000-000000000002","kind":"yes_no","label":"Original false","required":false}]',true,'published');
    insert into public.form_assignments values('${tenant}','${form}','00000000-0000-4000-8000-000000000904','Retained assigned');
    insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,submitted_at,last_edited_by,last_editor_name)select '${tenant}','${form}','00000000-0000-4000-8000-000000000903','Original responder','submitted','{"6e900000-0000-4000-8000-000000000002":false}',schema,name,'2026-03-08T07:00:00.123456Z','${actor}','Original editor'from public.forms where id='${form}';`);
    const blocked=`create function pg_temp.report_snapshot_gate()returns jsonb language plpgsql stable as $$declare first_read jsonb;second_read jsonb;begin first_read:=public.read_forms_reporting('${tenant}','${form}');perform pg_sleep(1.5);second_read:=public.read_forms_reporting('${tenant}','${form}');return jsonb_build_array(first_read,second_read);end$$;${signed}select pg_temp.report_snapshot_gate();`;
    let work=pending(blocked);await wait();
    sql(`update public.form_responses set reviewed=true,reviewed_at=now(),reviewed_by='${actor}',reviewer_name='Synthetic reviewer',revision=revision+1 where form_id='${form}';`);
    let pair=JSON.parse(await work);
    if(pair[0].counts.reviewed!==0||pair[1].counts.reviewed!==0||pair[0].collectionVersion!==pair[1].collectionVersion)throw Error('STABLE reporting mixed concurrent review snapshots');
    let access=JSON.parse(query(`${signed}select public.read_forms_reporting_access('${tenant}','${form}');`).split('\n').at(-1));
    if(access.collectionVersion===pair[1].collectionVersion)throw Error('Fresh access failed to fence completed review mutation');
    results.push('PASS: concurrent review leaves one statement coherent; next signed access observes new collection version');
    work=pending(blocked);await wait();sql(`update public.tenant_memberships set role='manager'where tenant_id='${tenant}'and user_id='${actor}';`);
    pair=JSON.parse(await work);if(pair.some(d=>d.role!=='owner'||d.counts.reviewed!==1))throw Error('Stable scope unexpectedly mixed role snapshots');
    const denial=query(`${signed}do $$begin begin perform public.read_forms_reporting_access('${tenant}','${form}');raise exception 'Fresh reporting access accepted downgraded actor';exception when insufficient_privilege then null;end;end$$;select 'denied';`).split('\n').at(-1);
    if(denial!=='denied')throw Error('Fresh reporting authority did not deny downgrade');
    results.push('PASS: held initial snapshot cannot authorize fresh reporting after owner-to-manager downgrade');
  } finally {
    sql(`update public.tenant_memberships set role='owner'where tenant_id='${tenant}'and user_id='${actor}';delete from public.form_responses where form_id='${form}';delete from public.form_assignments where form_id='${form}';delete from public.forms where id='${form}';`);
  }
  return results;
}
