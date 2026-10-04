begin;
create function pg_temp.report_check(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function pg_temp.report_throws(code text,command text,label text)returns void language plpgsql as $$begin begin execute command;raise exception 'Expected SQLSTATE %',code;exception when others then if sqlstate<>code then raise exception 'FAIL %: expected %, actual % (%)',label,code,sqlstate,sqlerrm;end if;end;raise notice 'PASS: %',label;end$$;
create temporary table report_state(k text primary key,v jsonb);grant all on report_state to authenticated;
insert into report_state values('filters','{"from":null,"to":null,"review":"all","search":"","submission":"all","fieldId":null,"fieldAnswer":"all"}');
insert into report_state values('schema','[{"id":"6e100000-0000-4000-8000-000000000001","kind":"description","text":"Original reporting instructions"},{"id":"6e100000-0000-4000-8000-000000000002","kind":"text","label":"Optional text","required":false},{"id":"6e100000-0000-4000-8000-000000000003","kind":"yes_no","label":"False answered","required":true},{"id":"6e100000-0000-4000-8000-000000000004","kind":"single_choice","label":"Choice","required":true,"options":[{"id":"6e100000-0000-4000-8000-000000000007","label":"Original choice"}]},{"id":"6e100000-0000-4000-8000-000000000005","kind":"multiple_choice","label":"Optional choices","required":false,"options":[{"id":"6e100000-0000-4000-8000-000000000007","label":"Original choice"}]},{"id":"6e100000-0000-4000-8000-000000000006","kind":"number","label":"Precise decimal","required":true}]');
insert into report_state values('answers','{"6e100000-0000-4000-8000-000000000002":" \n ","6e100000-0000-4000-8000-000000000003":false,"6e100000-0000-4000-8000-000000000004":"6e100000-0000-4000-8000-000000000007","6e100000-0000-4000-8000-000000000005":[],"6e100000-0000-4000-8000-000000000006":"+123456789012.123456"}');
update public.tenants set time_zone='America/New_York'where id='88000000-0000-4000-8000-000000000001';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare a jsonb;t uuid:='88000000-0000-4000-8000-000000000001';begin
 a:=public.save_form(t,gen_random_uuid(),jsonb_build_object('action','create_form','name','=Original reporting form','description','Synthetic','schema',(select v from report_state where k='schema'),'audienceIds',jsonb_build_array('00000000-0000-4000-8000-000000000903','00000000-0000-4000-8000-000000000904'),'allowRespondentEdit',true)::text);insert into report_state values('form',a);
 perform pg_temp.report_check(public.read_forms_reporting(t,(a->>'formId')::uuid)->'counts'->>'total'='0','genuine empty draft entries contain zero submitted rows');
 perform pg_temp.report_check(public.read_forms_reporting(t,(a->>'formId')::uuid,'summary',(select v from report_state where k='filters'))->'fields'->0->>'answered'='0','genuine empty draft summary carries actual answerable schema and zero counts');
 perform pg_temp.report_throws('22023',format('select public.read_forms_reporting(%L,%L,''field'',%L)',t,a->>'formId',((select v from report_state where k='filters')||'{"fieldId":"6e100000-0000-4000-8000-000000000003"}')::text),'draft field drilldown denied until frozen');
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','publish_form','formId',a->>'formId','formRevision',1)::text);
end$$;reset role;
insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,submitted_at,last_edited_by,last_editor_name,last_edited_at,updated_at)
select '88000000-0000-4000-8000-000000000001',((select v from report_state where k='form')->>'formId')::uuid,
case when n=1 then '00000000-0000-4000-8000-000000000903'::uuid else ('00000000-0000-4000-8010-'||lpad(n::text,12,'0'))::uuid end,
'Historical original '||n,'submitted',(select v from report_state where k='answers'),(select v from report_state where k='schema'),'=Original reporting form',
'2026-03-08 07:00:00.123456Z'::timestamptz+n*interval '1 microsecond','00000000-0000-4000-8000-000000000903','Original editor','2026-11-01 07:00:00.654321Z','2026-11-01 07:00:00.654321Z'from generate_series(1,1005)n;
insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,last_edited_by,last_editor_name)
select '88000000-0000-4000-8000-000000000001',((select v from report_state where k='form')->>'formId')::uuid,'00000000-0000-4000-8000-000000000904','Secret progress name','in_progress','{"6e100000-0000-4000-8000-000000000002":"SECRET PROGRESS NEVER REPORT"}',(select v from report_state where k='schema'),'=Original reporting form','00000000-0000-4000-8000-000000000904','Secret progress editor';
set role authenticated;
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='form')->>'formId')::uuid;p jsonb:=(select v from report_state where k='filters');d jsonb;c jsonb;seen uuid[]:='{}';id uuid;a text;begin
 d:=public.read_forms_reporting(t,f);perform pg_temp.report_check(d->'counts'->>'total'='1005'and jsonb_array_length(d->'responses')=50,'exact >1000 count independent of bounded first page');
 loop
  d:=public.read_forms_reporting(t,f,'entries',p,100,c,false);
  for a in select value->>'id'from jsonb_array_elements(d->'responses')loop id:=a::uuid;if id=any(seen)then raise exception 'Repeated paged response';end if;seen:=array_append(seen,id);end loop;
  c:=d->'nextCursor';exit when c='null'::jsonb;
 end loop;perform pg_temp.report_check(cardinality(seen)=1005,'all >1000 submitted rows paged exactly once');
 d:=public.read_forms_reporting(t,f,'status',p);perform pg_temp.report_check(d->'counts'->>'total'='2'and d->'counts'->>'submitted'='1'and d->'counts'->>'notSubmitted'='1'and d->'counts'->>'assignmentTotal'='2','current assigned status excludes historical unassigned submitters');
 perform pg_temp.report_check(d->'users'->1->'response'='null'::jsonb and strpos(d::text,'SECRET')=0 and strpos(d::text,'Secret progress')=0,'private progress is indistinguishable from no submission');
 d:=public.read_forms_reporting(t,f,'summary',p);perform pg_temp.report_check(d->'counts'->>'total'='1005'and d->'fields'->1->>'answered'='1005'and d->'fields'->1->'options'->1->>'count'='1005','false is answered and No distribution exact');
 perform pg_temp.report_check(d->'fields'->0->>'empty'='1005'and d->'fields'->3->>'empty'='1005'and d->'fields'->4->>'answered'='1005','whitespace optional text and empty multiple choice are empty; numeric string answered');
 d:=public.read_forms_reporting(t,f,'field',p||'{"fieldId":"6e100000-0000-4000-8000-000000000005","fieldAnswer":"empty"}');perform pg_temp.report_check(d->'counts'->>'matched'='1005'and d->'responses'->0->'answer'='[]'::jsonb,'empty multiple selections retained in drilldown rather than omitted');
 d:=public.read_forms_reporting(t,f,'entries',p,50,null,true);perform pg_temp.report_check(jsonb_array_length(d->'responses')=1005 and not(d?'nextCursor')and d->'responses'->0->'answers'->>'6e100000-0000-4000-8000-000000000006'='+123456789012.123456'and not(d->'responses'->0?'schema'),'complete export keeps precision and schema once without page mixing');
 perform pg_temp.report_check(((d->'responses'->0)-'answers'-'formName')=workforce_private.forms_response_json(t,(d->'responses'->0->>'id')::uuid,'manage'),'inline export renderer exactly matches baseline metadata and edit capacities');
 d:=public.read_forms_reporting(t,f,'status',p||'{"from":"2026-11-01","to":"2026-11-01"}');perform pg_temp.report_check(d->'counts'->>'notSubmitted'='2'and d->'counts'->>'assignmentTotal'='2'and not exists(select 1 from jsonb_array_elements(d->'users')u where u->'response'<>'null'::jsonb),'outside original submission day response metadata withheld despite later content edits');
 d:=public.read_forms_reporting(t,f,'entries',p||'{"from":"2026-03-08","to":"2026-03-08"}');perform pg_temp.report_check(d->'counts'->>'total'='1005','DST company day selects first submission civil date');
 perform pg_temp.report_throws('22023',format('select public.read_forms_reporting(%L,%L,''summary'',%L,1)',t,f,p::text),'summary requires canonical limit50');
 perform pg_temp.report_throws('22023',format('select public.read_forms_reporting(%L,%L,''entries'',%L)',t,f,(p||'{"from":"2026-02-30","to":"2026-03-01"}')::text),'invalid calendar date rejected');
 perform pg_temp.report_throws('22023',format('select public.read_forms_reporting(%L,%L,''entries'',%L)',t,f,(p||'{"from":"2025-01-01","to":"2026-01-02"}')::text),'367 day range rejected');
 perform pg_temp.report_throws('22023',format('select public.read_forms_reporting(%L,%L,''entries'',%L)',t,f,(p||jsonb_build_object('search',repeat('😀',51)))::text),'search bounded by UTF16 not codepoints');
 d:=public.read_forms_reporting(t,f);c:=d->'nextCursor';perform pg_temp.report_throws('40001',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,%L)',t,f,(p||'{"search":"Other"}')::text,c::text),'cursor scope binds literal query');
 perform pg_temp.report_throws('40001',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,%L)',t,f,p::text,jsonb_set(c,'{position,key}','"yesterday"')::text),'cursor exact saved microsecond position checked before timestamp cast');
 insert into report_state values('version',to_jsonb(d->>'collectionVersion'));
end$$;reset role;
update public.form_responses set answers='{}',revision=revision+1 where status='in_progress'and form_id=((select v from report_state where k='form')->>'formId')::uuid;
set role authenticated;
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='form')->>'formId')::uuid;begin
 perform pg_temp.report_check(public.read_forms_reporting_access(t,f)->>'collectionVersion'=(select v#>>'{}'from report_state where k='version'),'private progress updates do not change report version');
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',false);
select pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'assigned manager denied reporting');
select pg_temp.report_throws('42501',format('select workforce_private.forms_reporting_version(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'direct privileged private version helper denied manager');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'null original Auth denied rather than nullable IF fallthrough');
reset role;
select pg_temp.report_check(not has_function_privilege('anon','public.read_forms_reporting(uuid,uuid,text,jsonb,integer,jsonb,boolean)','execute')and not has_function_privilege('service_role','public.read_forms_reporting(uuid,uuid,text,jsonb,integer,jsonb,boolean)','execute'),'RPC authenticated-only ACL excludes anon and service role');
-- Current signed authority, retained SQL ordering and malformed-record refusal.
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000902',false);
do $$declare f uuid:=((select v from report_state where k='form')->>'formId')::uuid;begin
 perform pg_temp.report_check(public.read_forms_reporting('88000000-0000-4000-8000-000000000001',f)->>'role'='admin','unassigned current admin can report submitted records');
 perform pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000002',f),'foreign-company report denied even with a known form UUID');
end$$;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000904',false);
select pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'assigned employee denied report access');reset role;
update public.tenant_memberships set status='suspended'where tenant_id='88000000-0000-4000-8000-000000000001'and user_id='00000000-0000-4000-8000-000000000901';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
select pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'old Auth claim denied after current membership suspended');reset role;
update public.tenant_memberships set status='active'where tenant_id='88000000-0000-4000-8000-000000000001'and user_id='00000000-0000-4000-8000-000000000901';
update auth.users set email_confirmed_at=null where id='00000000-0000-4000-8000-000000000901';set role authenticated;
select pg_temp.report_throws('42501',format('select public.read_forms_reporting(%L,%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form')),'unconfirmed original Auth owner denied');reset role;
update auth.users set email_confirmed_at=now()where id='00000000-0000-4000-8000-000000000901';
update public.form_assignments set name=case when actor_id='00000000-0000-4000-8000-000000000903'then 'İstanbul 😀'else 'Iceland' end where form_id=((select v from report_state where k='form')->>'formId')::uuid;
set role authenticated;
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='form')->>'formId')::uuid;p jsonb:=(select v from report_state where k='filters');d jsonb;expected jsonb;next_read jsonb;begin
 d:=public.read_forms_reporting(t,f,'status',p,1);select jsonb_build_object('id',actor_id,'key',lower(name))into expected from public.form_assignments where form_id=f order by lower(name),actor_id limit 1;
 perform pg_temp.report_check(d->'nextCursor'->'position'=expected,'status cursor uses actual PostgreSQL Unicode lowercase ordering');
 next_read:=public.read_forms_reporting(t,f,'status',p,1,d->'nextCursor');perform pg_temp.report_check(next_read->'users'->0->>'actorId'<>d->'users'->0->>'actorId'and next_read->'nextCursor'='null'::jsonb,'status opaque SQL keyset pages exact retained assignments');
 d:=public.read_forms_reporting(t,f,'status',p||'{"search":"İstanbul","submission":"submitted"}');perform pg_temp.report_check(d->'counts'->>'total'='1'and d->'counts'->>'assignmentTotal'='2'and d->'users'->0->>'name'='İstanbul 😀','status search uses retained assignment name and denominator ignores filters');
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','archive_form','formId',f,'formRevision',2)::text);
 d:=public.read_forms_reporting(t,f);perform pg_temp.report_check(d->'form'->>'status'='archived'and d->'responses'->0->>'canReview'='false'and d->'counts'->>'total'='1005','archived submitted reporting retained with read-only review capabilities');
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','restore_form','formId',f,'formRevision',3)::text);
end$$;reset role;
update public.form_responses set schema=jsonb_set(schema,'{1,label}','"Mismatched retained question"')where form_id=((select v from report_state where k='form')->>'formId')::uuid and actor_id='00000000-0000-4000-8000-000000000903';set role authenticated;
select pg_temp.report_throws('XX000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form'),(select v::text from report_state where k='filters')),'narrow schema match projection rejects differing retained question label');
select pg_temp.report_throws('XX000',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,null,true)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form'),(select v::text from report_state where k='filters')),'complete export rejects retained schema mismatch before response construction');reset role;
update public.form_responses set schema=(select v from report_state where k='schema')where form_id=((select v from report_state where k='form')->>'formId')::uuid and actor_id='00000000-0000-4000-8000-000000000903';
update public.form_responses set answers='{}'where form_id=((select v from report_state where k='form')->>'formId')::uuid and actor_id='00000000-0000-4000-8000-000000000903';set role authenticated;
select pg_temp.report_throws('XX000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form'),(select v::text from report_state where k='filters')),'empty object fast path never bypasses complete required fields');
select pg_temp.report_throws('XX000',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,null,true)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form'),(select v::text from report_state where k='filters')),'complete export still rejects missing required answers before building workbook');reset role;
update public.form_responses set answers=(select v from report_state where k='answers')where form_id=((select v from report_state where k='form')->>'formId')::uuid and actor_id='00000000-0000-4000-8000-000000000903';
update public.form_responses set answers=answers||'{"6e100000-0000-4000-8000-000000000006":""}'where actor_id='00000000-0000-4000-8000-000000000903';set role authenticated;
select pg_temp.report_throws('XX000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)','88000000-0000-4000-8000-000000000001',(select v->>'formId'from report_state where k='form'),(select v::text from report_state where k='filters')),'malformed submitted numeric does not become an empty summary or zero');reset role;
update public.form_responses set answers=(select v from report_state where k='answers')where actor_id='00000000-0000-4000-8000-000000000903';
-- Complete-scope bounds apply before expensive aggregation; pages remain useful.
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);reset role;
update public.form_responses set answers=answers||jsonb_build_object('6e100000-0000-4000-8000-000000000002',repeat('x',5000))where status='submitted'and form_id=((select v from report_state where k='form')->>'formId')::uuid;
set role authenticated;
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='form')->>'formId')::uuid;p jsonb:=(select v from report_state where k='filters');begin
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)',t,f,p::text),'complete raw answers above2MiB summary rejected');
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,null,true)',t,f,p::text),'complete raw answers above2MiB export rejected');
 perform pg_temp.report_check(jsonb_array_length(public.read_forms_reporting(t,f)->'responses')=50,'bounded entries remain available above complete-export byte bound');
end$$;reset role;
update public.form_responses set answers=(select v from report_state where k='answers')where status='submitted'and form_id=((select v from report_state where k='form')->>'formId')::uuid;
insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,submitted_at,last_edited_by,last_editor_name)
select tenant_id,form_id,('00000000-0000-4000-8011-'||lpad(n::text,12,'0'))::uuid,'Large submitted '||n,'submitted',answers,schema,form_name,submitted_at,'00000000-0000-4000-8000-000000000903','Original'from public.form_responses z cross join generate_series(1,8996)n where z.actor_id='00000000-0000-4000-8000-000000000903'and z.form_id=((select v from report_state where k='form')->>'formId')::uuid;
set role authenticated;
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='form')->>'formId')::uuid;p jsonb:=(select v from report_state where k='filters');begin
 perform pg_temp.report_check(public.read_forms_reporting(t,f)->'counts'->>'total'='10001','exact >10000 paged count is not capped');
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)',t,f,p::text),'complete >10000 summary refused');
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,null,true)',t,f,p::text),'complete >10000 export refused');
end$$;reset role;
-- Fifty fields, twenty alternatives per choice and near2MiB answers exercise
-- the maximum-schema grouped distribution rather than option-by-option rescans.
insert into report_state(k,v)select 'largeSchema',jsonb_build_array(jsonb_build_object('id','6e300000-0000-4000-8000-000000000001','kind','text','label','Optional text','required',false))||jsonb_agg(jsonb_build_object('id','6e300000-0000-4000-8000-'||lpad(n::text,12,'0'),'kind','single_choice','label','Choice '||n,'required',false,'options',(select jsonb_agg(jsonb_build_object('id','6e400000-0000-4000-8000-'||lpad(o::text,12,'0'),'label',repeat('L',20)||o))from generate_series(1,20)o)))from generate_series(2,50)n;
insert into report_state(k,v)select 'largeAnswers',jsonb_build_object('6e300000-0000-4000-8000-000000000001',repeat('x',600))||jsonb_object_agg('6e300000-0000-4000-8000-'||lpad(n::text,12,'0'),'6e400000-0000-4000-8000-000000000001')from generate_series(2,50)n;
set role authenticated;
do $$declare a jsonb;begin a:=public.save_form('88000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','create_form','name','Large schema original','description','','schema',(select v from report_state where k='largeSchema'),'audienceIds',jsonb_build_array('00000000-0000-4000-8000-000000000903'),'allowRespondentEdit',false)::text);insert into report_state values('largeForm',a);perform public.save_form('88000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','publish_form','formId',a->>'formId','formRevision',1)::text);end$$;reset role;
insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,submitted_at,last_edited_by,last_editor_name)
select '88000000-0000-4000-8000-000000000001',((select v from report_state where k='largeForm')->>'formId')::uuid,('00000000-0000-4000-8012-'||lpad(n::text,12,'0'))::uuid,'Large field respondent '||n,'submitted',(select v from report_state where k='largeAnswers'),(select v from report_state where k='largeSchema'),'Large schema original',now(),'00000000-0000-4000-8000-000000000903','Original'from generate_series(1,450)n;
select pg_temp.report_check((select sum(octet_length(answers::text))between 1800000 and 2097152 from public.form_responses where form_id=((select v from report_state where k='largeForm')->>'formId')::uuid),'performance scope has genuine near2MiB raw answers');
set role authenticated;set local statement_timeout='20s';
do $$declare d jsonb;stamp timestamptz:=clock_timestamp();begin
 d:=public.read_forms_reporting('88000000-0000-4000-8000-000000000001',((select v from report_state where k='largeForm')->>'formId')::uuid,'summary',(select v from report_state where k='filters'));
 perform pg_temp.report_check(jsonb_array_length(d->'fields')=50 and d->'fields'->49->'options'->0->>'count'='450'and d->'fields'->49->'options'->19->>'count'='0','50-field near-bound summary exact grouped options');raise notice 'PERFORMANCE: near2MiB/50field/980options summary % seconds',extract(epoch from clock_timestamp()-stamp);
end$$;
reset role;
insert into public.form_responses(tenant_id,form_id,actor_id,author_name,status,answers,schema,form_name,submitted_at,last_edited_by,last_editor_name)
select '88000000-0000-4000-8000-000000000001',((select v from report_state where k='largeForm')->>'formId')::uuid,('00000000-0000-4000-8013-'||lpad(n::text,12,'0'))::uuid,'Empty retained respondent '||n,'submitted','{}',(select v from report_state where k='largeSchema'),'Large schema original',now(),'00000000-0000-4000-8000-000000000903','Original'from generate_series(1,9550)n;
set role authenticated;set local statement_timeout='8s';
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';f uuid:=((select v from report_state where k='largeForm')->>'formId')::uuid;p jsonb:=(select v from report_state where k='filters');stamp timestamptz:=clock_timestamp();begin
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''summary'',%L)',t,f,p::text),'large10000 frozen-schema summary refused before validation workload');
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''entries'',%L,50,null,true)',t,f,p::text),'large10000 frozen-schema entry export refused before workload');
 perform pg_temp.report_throws('54000',format('select public.read_forms_reporting(%L,%L,''field'',%L)',t,f,(p||'{"fieldId":"6e300000-0000-4000-8000-000000000001"}')::text),'large10000 frozen-schema field scope refused before workload');
 perform pg_temp.report_throws('54000',format('select workforce_private.forms_reporting_validate_scope(%L,%L,%L)',t,f,p::text),'direct guarded complete validator cannot bypass schema-workload cap');
 raise notice 'PERFORMANCE: large10000schema early-workload refusal % seconds',extract(epoch from clock_timestamp()-stamp);
end$$;
reset role;
-- A small frozen schema still allows the genuine complete10000 scope.
update public.forms set schema='[{"id":"6e300000-0000-4000-8000-000000000001","kind":"yes_no","label":"Optional answer","required":false}]'where id=((select v from report_state where k='largeForm')->>'formId')::uuid;
update public.form_responses set schema=(select schema from public.forms where id=((select v from report_state where k='largeForm')->>'formId')::uuid)where form_id=((select v from report_state where k='largeForm')->>'formId')::uuid;
update public.form_responses set answers='{}',author_name='R',last_editor_name='E',form_name='F'where form_id=((select v from report_state where k='largeForm')->>'formId')::uuid;
set role authenticated;set local statement_timeout='8s';
do $$declare d jsonb;stamp timestamptz:=clock_timestamp();begin
 d:=public.read_forms_reporting('88000000-0000-4000-8000-000000000001',((select v from report_state where k='largeForm')->>'formId')::uuid,'summary',(select v from report_state where k='filters'));
 perform pg_temp.report_check(d->'counts'->>'total'='10000'and d->'fields'->0->>'empty'='10000','complete10000 small-schema summary exact optional empties');raise notice 'PERFORMANCE: complete10000 small-schema summary % seconds',extract(epoch from clock_timestamp()-stamp);stamp:=clock_timestamp();
 d:=public.read_forms_reporting('88000000-0000-4000-8000-000000000001',((select v from report_state where k='largeForm')->>'formId')::uuid,'entries',(select v from report_state where k='filters'),50,null,true);
 perform pg_temp.report_check(jsonb_array_length(d->'responses')=10000 and jsonb_array_length(d->'schema')=1 and octet_length(d::text)<=8388608 and not(d->'responses'->0?'schema'),'complete10000 small-schema entry export retains schema once within8MiB');raise notice 'PERFORMANCE: complete10000rows/small-schema entry export % seconds, % bytes',extract(epoch from clock_timestamp()-stamp),octet_length(d::text);
end$$;
reset role;
rollback;


