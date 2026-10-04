\set ON_ERROR_STOP on
-- Disposable local fixture only; IDs differ from retained 810-series upgrade rows.
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(980901,980906)n;
insert into public.tenants(id,name,time_zone) values('a1000000-0000-4000-8000-000000000001','Synthetic period A','UTC'),('a1000000-0000-4000-8000-000000000002','Synthetic period B','UTC');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select 'a1000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||n,case n when 980901 then 'owner' when 980902 then 'admin' when 980903 then 'manager' when 980905 then 'manager' else 'employee' end from generate_series(980901,980905)n;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values('a1000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000980906','Foreign','owner');
insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,created_by) values
('a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000980904','Synthetic','Linked','+447700980904','00000000-0000-4000-8000-000000980901'),
('a3000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001',null,'Synthetic','Directory','+447700980999','00000000-0000-4000-8000-000000980901'),
('a3000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000980906','Synthetic','Foreign','+447700980906','00000000-0000-4000-8000-000000980906');
insert into public.rota_schedules(id,tenant_id,name,time_zone) values
('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','Period main','UTC'),
('a2000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','Period other','UTC'),
('a2000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','Period foreign','UTC');
insert into public.rota_agents values
('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001'),
('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000002'),
('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001'),
('a1000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000003');
insert into public.rota_admins values('a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000980903');
insert into public.rota_jobs(id,tenant_id,schedule_id,name,color) values
('a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001','Period visits','#3487ee'),
('a4000000-0000-4000-8000-000000000002','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','Other visits','#3487ee'),
('a4000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000002','a2000000-0000-4000-8000-000000000003','Foreign visits','#3487ee');
insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title,status,published_at)
select ('a5000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',case when n=1 then 'a3000000-0000-4000-8000-000000000001'::uuid else 'a3000000-0000-4000-8000-000000000002'::uuid end,'a4000000-0000-4000-8000-000000000001',st,en,title,case when n=2 then 'published'else 'draft'end,case when n=2 then now()end
from(values(1,'2026-10-05 09:00:00.000001+00'::timestamptz,'2026-10-05 17:00:00.000002+00'::timestamptz,E'Precise\nretained'),(2,'2026-10-04 23:00+00','2026-10-05 07:00+00','Published carry-in'),(3,'2026-10-04 23:59:59+00','2026-10-05 00:00:00.000001+00','One microsecond edge'),(4,'2026-10-04 18:00+00','2026-10-05 00:00+00','Excluded end adjacency'),(5,'2026-10-06 00:00+00','2026-10-06 01:00+00','Excluded start adjacency'))v(n,st,en,title);
insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title)values('a5000000-0000-4000-8000-000000000006','a1000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002','2026-11-02 09:00+00','2026-11-02 10:00+00','Private other commitment');
create function pg_temp.period_check(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
create function pg_temp.period_error(command text,expected text,label text)returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end$$;
create temporary table period_state(k text primary key,v jsonb);grant all on period_state to authenticated;
create function pg_temp.period_source(extra jsonb default '{}')returns jsonb language sql as $$select public.preview_rota_period_template('a1000000-0000-4000-8000-000000000001',(jsonb_build_object('mode','source-preview','tenantId','a1000000-0000-4000-8000-000000000001','scheduleId','a2000000-0000-4000-8000-000000000001','scheduleRevision',(select revision from public.rota_schedules where id='a2000000-0000-4000-8000-000000000001'),'kind','day','sourceAnchor','2026-10-05','sourceFilters',jsonb_build_object('jobId',null,'status','all','workerSearch',''))||extra)::text)$$;
create function pg_temp.period_save(op uuid default gen_random_uuid(),extra jsonb default '{}')returns jsonb language plpgsql as $$declare r jsonb;c jsonb;begin r:=pg_temp.period_source();c:=jsonb_build_object('action','save','schedule_id','a2000000-0000-4000-8000-000000000001','schedule_revision',(r->'schedule'->>'revision')::integer,'kind','day','title','Precise day','source_anchor','2026-10-05','source_zone','UTC','source_filters',r->'source'->'filters','source_review_digest',r->'sourceReviewDigest','sources',r->'selectors');return public.save_rota_period_template('a1000000-0000-4000-8000-000000000001',op,(c||extra)::text);end$$;
create function pg_temp.period_target(extra jsonb default '{}')returns jsonb language sql as $$select public.preview_rota_period_template('a1000000-0000-4000-8000-000000000001',(jsonb_build_object('mode','preview','tenantId','a1000000-0000-4000-8000-000000000001','scheduleId','a2000000-0000-4000-8000-000000000001','scheduleRevision',(select revision from public.rota_schedules where id='a2000000-0000-4000-8000-000000000001'),'templateId',(select v->>'template_id'from period_state where k='saved'),'templateRevision',1,'targetAnchor','2026-11-02','occurrences','[]'::jsonb,'pageKind','entries')||extra)::text)$$;
select pg_temp.period_check(not has_table_privilege('authenticated','public.rota_period_entries','INSERT')and not has_table_privilege('authenticated','public.rota_period_generated','SELECT'),'new provenance and history have no direct browser access');
select pg_temp.period_check(not has_function_privilege('anon','public.save_rota_period_template(uuid,uuid,text)','EXECUTE')and not has_function_privilege('service_role','public.preview_rota_period_template(uuid,text)','EXECUTE'),'anonymous and service provider cannot invoke period functions');
select pg_temp.period_check(not exists(select 1 from pg_constraint c where c.conrelid in('public.rota_period_entries'::regclass,'public.rota_period_generated'::regclass)and c.confrelid in('public.rota_shifts'::regclass,'public.agents'::regclass,'public.rota_jobs'::regclass)),'provenance never constrains legacy shift worker job deletion');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980901',false);
insert into period_state values('source',pg_temp.period_source());
select pg_temp.period_check((select(v->'source'->>'entryCount')::integer=3 and jsonb_array_length(v->'selectors')=3 and(v->>'firstPage')::boolean from period_state where k='source'),'authoritative source includes microsecond edge and excludes exact adjacency');
select pg_temp.period_check((select v->'entries'->0->>'source_starts_at'='2026-10-05T09:00:00.000001Z'and v->'entries'->0->>'source_ends_at'='2026-10-05T17:00:00.000002Z'and v->'entries'->0->>'title'=E'Precise\nretained'from period_state where k='source'),'immutable captured original six-digit endpoints and legacy newline title');
insert into period_state values('page1',pg_temp.period_source('{"limit":1}'));
insert into period_state values('page2',pg_temp.period_source(jsonb_build_object('limit',1,'cursor',(select v->'page'->'nextCursor'from period_state where k='page1'))));
select pg_temp.period_check((select not(v?'selectors')and v->>'firstPage'='false'and v->'entries'->0->>'index'='1'and v->'sourceReviewDigest'=(select v->'sourceReviewDigest'from period_state where k='page1')from period_state where k='page2'),'later source page omits selectors and binds complete digest');
select pg_temp.period_error($q$select pg_temp.period_source('{"kind":"week","sourceAnchor":"2026-10-06"}')$q$,'22023','Week source requires exact Monday');
select pg_temp.period_error($q$select pg_temp.period_save(gen_random_uuid(),'{"sources":[]}')$q$,'22023','empty Save fails atomically');
select pg_temp.period_error($q$select pg_temp.period_save(gen_random_uuid(),'{"source_review_digest":"wrong"}')$q$,'40001','changed source digest cannot save');
select pg_temp.period_error($q$select pg_temp.period_save(gen_random_uuid(),jsonb_build_object('title',repeat(chr(160),5)))$q$,'22023','signed directRPC allNBSP newtitle rejected without poisoning catalogue');
select pg_temp.period_error($q$select pg_temp.period_save(gen_random_uuid(),jsonb_build_object('title',chr(133)))$q$,'22023','signed directRPC C1NEL-only title rejected exactlylike purevalidator');
select pg_temp.period_error($q$select pg_temp.period_save(gen_random_uuid(),jsonb_build_object('title','Name'||chr(133)||' title'))$q$,'22023','signed directRPC interiorC1 title rejected without locale-dependent controlcheck');
begin;
do $$declare result jsonb;catalogue jsonb;begin result:=pg_temp.period_save(gen_random_uuid(),jsonb_build_object('title',chr(160)||chr(8195)||'Canonical title'||chr(12288)||chr(65279)));catalogue:=public.read_rota_period_templates('a1000000-0000-4000-8000-000000000001','{"tenantId":"a1000000-0000-4000-8000-000000000001","scheduleId":"a2000000-0000-4000-8000-000000000001","kind":"day"}');perform pg_temp.period_check(catalogue->'templates'->0->>'title'='Canonical title'and result->>'template_revision'='1','signed directRPC Unicodeedge whitespace canonicalized onlyfor newmetadata title');end$$;
rollback;
insert into period_state values('saved',pg_temp.period_save('a6000000-0000-4000-8000-000000000001'));
select pg_temp.period_check((select v->>'entry_count'='3'and v->>'template_revision'='1'and v->>'schedule_revision'='2'and v->'generated'='[]'::jsonb from period_state where k='saved'),'Save captures complete source and advances one schedule revision');
reset role;
select pg_temp.period_check((select count(*)=3 from public.rota_period_entries where tenant_id='a1000000-0000-4000-8000-000000000001')and(select count(*)=6 from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000001'),'Save creates no shifts and exactly retained immutable entries');
update public.rota_shifts set title='Later edited',revision=revision+1 where id='a5000000-0000-4000-8000-000000000001';
set role authenticated;
insert into period_state values('target',pg_temp.period_target());
select pg_temp.period_check((select v->'entries'->0->'entry'->>'title'=E'Precise\nretained'and v->'entries'->0->>'starts_at'='2026-11-02T09:00:00.000001Z'and(v->>'canAdd')::boolean and v->>'visibleCommitmentCount'='1'from period_state where k='target'),'target uses immutable precise snapshot and exact visible distinct conflict');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980903',false);
insert into period_state values('manager',pg_temp.period_target('{"pageKind":"visibleCommitments"}'));
select pg_temp.period_check((select v->>'hasHiddenConflicts'='true'and v->>'visibleCommitmentCount'='0'and v->'commitments'='[]'::jsonb and v->'capacity'->>'companyUsageVisible'='false'and v->'capacity'->'shifts'='null'::jsonb and v::text not like '%Private other commitment%'and v::text not like '%a5000000-0000-4000-8000-000000000006%'from period_state where k='manager'),'delegated manager gets opaque hidden conflict and no company count or tuple');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980901',false);
insert into period_state values('addchange',jsonb_build_object('action','add','schedule_id','a2000000-0000-4000-8000-000000000001','schedule_revision',2,'template_id',(select v->'template_id'from period_state where k='saved'),'template_revision',1,'target_anchor','2026-11-02','occurrences','[]'::jsonb,'plan_digest',(select v->'planDigest'from period_state where k='target'),'expected_entry_count',3,'allow_overlap',true));
select pg_temp.period_error($q$select public.save_rota_period_template('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),((select v from period_state where k='addchange')||'{"allow_overlap":false}')::text)$q$,'P0001','entire batch overlap requires explicit acknowledgement');
insert into period_state values('added',public.save_rota_period_template('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002',(select v::text from period_state where k='addchange')));
select pg_temp.period_check((select jsonb_array_length(v->'generated')=3 and v->>'template_revision'='1'and v->>'schedule_revision'='3'and v->'generated'->2->>'index'='2'from period_state where k='added'),'Add returns full indexed batch without changing source template');
select pg_temp.period_check(public.save_rota_period_template('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002',(select v::text from period_state where k='addchange'))=(select v from period_state where k='added'),'exact Add replay returns immutable receipt without another write');
select pg_temp.period_error($q$select public.save_rota_period_template('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002',((select v from period_state where k='addchange')||'{"target_anchor":"2026-11-03"}')::text)$q$,'40001','same UUID changed payload cannot mutate');
select pg_temp.period_check(public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','add','a2000000-0000-4000-8000-000000000001',(select(v->>'template_id')::uuid from period_state where k='saved'))->'saved'=(select v from period_state where k='added'),'recorded recovery returns complete exact result');
select pg_temp.period_check(public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003','add','a2000000-0000-4000-8000-000000000001',(select(v->>'template_id')::uuid from period_state where k='saved'))->>'status'='not_recorded','absent recovery durably closes original identity');
select pg_temp.period_error($q$select public.save_rota_period_template('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000003',(select v::text from period_state where k='addchange'))$q$,'40001','late original Add cannot pass durable absence closure');
reset role;
select pg_temp.period_check((select count(*)=3 from public.rota_period_generated where tenant_id='a1000000-0000-4000-8000-000000000001')and(select count(*)=9 from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000001')and(select count(*)=2 from public.rota_period_audit where tenant_id='a1000000-0000-4000-8000-000000000001'),'atomic Add emits one audit and one immutable history link per new draft');
-- Existing SQL permits long outer spaces: current display trims independently;
-- captured source retains exact bytes within bound and rejects overflow atomically.
update public.agents set first_name=repeat(' ',500)||first_name||repeat(' ',500)where id='a3000000-0000-4000-8000-000000000001';
update public.rota_jobs set name=repeat(' ',500)||name||repeat(' ',500)where id='a4000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.period_error($q$select pg_temp.period_source()$q$,'22023','oversize raw captured labels fail explicitly without trimming');
select pg_temp.period_check(public.read_rota_period_templates('a1000000-0000-4000-8000-000000000001',jsonb_build_object('mode','history','tenantId','a1000000-0000-4000-8000-000000000001','scheduleId','a2000000-0000-4000-8000-000000000001','templateId',(select v->'template_id'from period_state where k='saved'),'templateRevision',1)::text)->'entries'->0->'availability'->>'currentAgentName'='Synthetic Linked','history survives later valid long current labels using bounded current presentation');
reset role;
delete from public.rota_shifts where id in(select shift_id from public.rota_period_generated where tenant_id='a1000000-0000-4000-8000-000000000001');
delete from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000001'and schedule_id='a2000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.period_check(public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','add','a2000000-0000-4000-8000-000000000001',(select(v->>'template_id')::uuid from period_state where k='saved'))->'saved'=(select v from period_state where k='added'),'history and recovery remain after permitted source and generated deletion');
reset role;
-- Whole-batch performance fixture: 5000 identical intervals, not pair counts.
insert into public.tenants(id,name,time_zone)values('a1000000-0000-4000-8000-000000000010','Synthetic period full batch','UTC');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role)values('a1000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000980901','Synthetic owner','owner');
insert into public.agents(id,tenant_id,first_name,last_name,phone,created_by)values('a3000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000010',repeat(' ',100)||repeat(chr(1),100),repeat(chr(1),100)||repeat(' ',100),'+447700981010','00000000-0000-4000-8000-000000980901');
insert into public.rota_schedules(id,tenant_id,name,time_zone)values('a2000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000010','Full batch','UTC');
insert into public.rota_agents values('a1000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000010');
insert into public.rota_jobs(id,tenant_id,schedule_id,name,color)values('a4000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000010',repeat(' ',100)||repeat(chr(1),100),'#3487ee');
insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title)select('a5100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a1000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000010','a4000000-0000-4000-8000-000000000010','2026-10-05 09:00:00.000001+00','2026-10-05 17:00:00.000002+00',repeat(chr(1),100)from generate_series(1,5000)n;
set role authenticated;
do $$declare t uuid:='a1000000-0000-4000-8000-000000000010';sid uuid:='a2000000-0000-4000-8000-000000000010';r jsonb;start_time timestamptz:=clock_timestamp();begin
 r:=public.preview_rota_period_template(t,jsonb_build_object('mode','source-preview','tenantId',t,'scheduleId',sid,'scheduleRevision',1,'kind','day','sourceAnchor','2026-10-05','sourceFilters',jsonb_build_object('jobId',null,'status','all','workerSearch',''))::text);
 perform pg_temp.period_check(jsonb_array_length(r->'selectors')=5000 and jsonb_array_length(r->'entries')=100,'actual5000 source selectors complete with bounded rich100rows');
 perform pg_temp.period_check(octet_length(r::text)<=1048576,'actual5000 source encodedresponse within1MiB');
 insert into period_state values('bulk_saved',public.save_rota_period_template(t,'a6000000-0000-4000-8000-000000000010',jsonb_build_object('action','save','schedule_id',sid,'schedule_revision',1,'kind','day','title','Full precise batch','source_anchor','2026-10-05','source_zone','UTC','source_filters',r->'source'->'filters','source_review_digest',r->'sourceReviewDigest','sources',r->'selectors')::text));
 raise notice 'PROFILE actual5000 authoritative source plus save: %',clock_timestamp()-start_time;
end$$;
reset role;delete from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000010';
set role authenticated;
do $$declare t uuid:='a1000000-0000-4000-8000-000000000010';sid uuid:='a2000000-0000-4000-8000-000000000010';tid uuid:=(select(v->>'template_id')::uuid from period_state where k='bulk_saved');r jsonb;cmd jsonb;ack jsonb;start_time timestamptz:=clock_timestamp();phase_time timestamptz:=clock_timestamp();begin
 r:=public.preview_rota_period_template(t,jsonb_build_object('mode','preview','tenantId',t,'scheduleId',sid,'scheduleRevision',2,'templateId',tid,'templateRevision',1,'targetAnchor','2026-11-02','occurrences','[]'::jsonb,'pageKind','affected')::text);
 raise notice 'PROFILE actual5000 single target RPC: %',clock_timestamp()-phase_time;perform pg_temp.period_check(clock_timestamp()-phase_time<interval '8 seconds','actual5000 target RPC below hosted8second statementlimit');phase_time:=clock_timestamp();
 perform pg_temp.period_check(r->>'entryCount'='5000'and r->>'affectedEntryCount'='5000'and r->>'canAdd'='true'and jsonb_array_length(r->'entries')=100,'actual5000 identical intervals flag every affectedentry without quadraticpairs');
 cmd:=jsonb_build_object('action','add','schedule_id',sid,'schedule_revision',2,'template_id',tid,'template_revision',1,'target_anchor','2026-11-02','occurrences','[]'::jsonb,'plan_digest',r->'planDigest','expected_entry_count',5000,'allow_overlap',true);
 ack:=public.save_rota_period_template(t,'a6000000-0000-4000-8000-000000000011',cmd::text);raise notice 'PROFILE actual5000 single Add RPC: %',clock_timestamp()-phase_time;perform pg_temp.period_check(clock_timestamp()-phase_time<interval '8 seconds','actual5000 Add RPC below hosted8second statementlimit');insert into period_state values('bulk_added',ack);
 perform pg_temp.period_check(jsonb_array_length(ack->'generated')=5000 and ack->'generated'->4999->>'index'='4999','actual5000 Add creates full indexed acknowledgement');
 raise notice 'PROFILE actual5000 entiretarget plus atomic Add: %',clock_timestamp()-start_time;
 phase_time:=clock_timestamp();r:=public.preview_rota_period_template(t,jsonb_build_object('mode','preview','tenantId',t,'scheduleId',sid,'scheduleRevision',3,'templateId',tid,'templateRevision',1,'targetAnchor','2026-11-09','occurrences','[]'::jsonb,'pageKind','blocked')::text);
 raise notice 'PROFILE actual5000 capacityblocked RPC: %',clock_timestamp()-phase_time;perform pg_temp.period_check(clock_timestamp()-phase_time<interval '8 seconds','actual5000 blocked plan RPC below hosted8second statementlimit');
 perform pg_temp.period_check(r->>'canAdd'='false'and r->'blockers'?'shift_capacity'and r->>'blockedEntryCount'='0'and jsonb_array_length(r->'entries')=0,'full live5000 capacity produces stable blocked plan with no falselyskippedentries');
end$$;
reset role;
select pg_temp.period_check((select count(*)=5000 from public.rota_period_generated where tenant_id='a1000000-0000-4000-8000-000000000010')and(select count(*)=5000 from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000010'),'actual5000 complete draftbatch and immutablelinks match');
-- All retained limits count tombstones/deleted history and closed operations.
insert into public.rota_period_templates(id,tenant_id,schedule_id,kind,title,source_anchor,source_zone,source_schedule_revision,source_filters,entry_count,user_count,elapsed_micros,creator_id,deleted_at)
select ('a7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,tenant_id,schedule_id,kind,'Retained snapshot '||n,source_anchor,source_zone,source_schedule_revision,source_filters,entry_count,user_count,elapsed_micros,creator_id,now()from public.rota_period_templates cross join generate_series(1,3)n where tenant_id='a1000000-0000-4000-8000-000000000010';
insert into public.rota_period_entries(tenant_id,schedule_id,template_id,entry_index,source_shift_id,agent_id,job_id,snapshot)select e.tenant_id,e.schedule_id,('a7100000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,e.entry_index,e.source_shift_id,e.agent_id,e.job_id,e.snapshot from public.rota_period_entries e cross join generate_series(1,3)n where e.tenant_id='a1000000-0000-4000-8000-000000000010'and e.template_id=(select(v->>'template_id')::uuid from period_state where k='bulk_saved');
set role authenticated;
select pg_temp.period_check(public.preview_rota_period_template('a1000000-0000-4000-8000-000000000010',jsonb_build_object('mode','source-preview','tenantId','a1000000-0000-4000-8000-000000000010','scheduleId','a2000000-0000-4000-8000-000000000010','scheduleRevision',3,'kind','day','sourceAnchor','2026-11-02','sourceFilters',jsonb_build_object('jobId',null,'status','all','workerSearch',''))::text)->'saveBlockers'?'entry_capacity','tombstoned immutable entries consume exact20000 company sourcebudget');
reset role;
insert into workforce_private.rota_period_operations(tenant_id,actor_id,operation_id,schedule_id,action,state)
select 'a1000000-0000-4000-8000-000000000010','00000000-0000-4000-8000-000000980901',('a7200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'a2000000-0000-4000-8000-000000000010','save','closed_absent'from generate_series(1,19998)n;
set role authenticated;
select pg_temp.period_check(public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000010','a6000000-0000-4000-8000-000000000011','add','a2000000-0000-4000-8000-000000000010',(select(v->>'template_id')::uuid from period_state where k='bulk_saved'))->'saved'=(select v from period_state where k='bulk_added'),'recorded full5000 recovery precedes full20000 operationquota');
select pg_temp.period_error($q$select public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000010','a6000000-0000-4000-8000-000000000099','save','a2000000-0000-4000-8000-000000000010',null)$q$,'54000','full operationbudget cannot falsely declare a new absence');
reset role;
select pg_temp.period_check((select count(*)=20000 from workforce_private.rota_period_operations where tenant_id='a1000000-0000-4000-8000-000000000010'),'denied absence does not consume or reclaim closed quota');
-- Retained generated links cannot be reclaimed by ordinary shift deletion.
delete from public.rota_shifts where tenant_id='a1000000-0000-4000-8000-000000000010';
insert into public.rota_period_audit(id,tenant_id,schedule_id,template_id,actor_id,operation_id,action,template_revision,schedule_revision)select('a7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,tenant_id,schedule_id,template_id,actor_id,gen_random_uuid(),'add',template_revision,schedule_revision from public.rota_period_audit cross join generate_series(1,3)n where tenant_id='a1000000-0000-4000-8000-000000000010'and action='add';
insert into public.rota_period_generated(tenant_id,schedule_id,template_id,audit_id,entry_index,shift_id,snapshot)select g.tenant_id,g.schedule_id,g.template_id,('a7300000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,g.entry_index,gen_random_uuid(),g.snapshot from public.rota_period_generated g cross join generate_series(1,3)n where g.tenant_id='a1000000-0000-4000-8000-000000000010'and g.audit_id=(select id from public.rota_period_audit where tenant_id='a1000000-0000-4000-8000-000000000010'and action='add'and id::text not like 'a730%');
set role authenticated;
select pg_temp.period_check(public.preview_rota_period_template('a1000000-0000-4000-8000-000000000010',jsonb_build_object('mode','preview','tenantId','a1000000-0000-4000-8000-000000000010','scheduleId','a2000000-0000-4000-8000-000000000010','scheduleRevision',3,'templateId',(select v->'template_id'from period_state where k='bulk_saved'),'templateRevision',1,'targetAnchor','2026-11-09','occurrences','[]'::jsonb,'pageKind','blocked')::text)->'blockers'?'generated_capacity','deleted draft history still consumes exact20000 immutablelinkbudget');
reset role;
insert into public.rota_period_templates(id,tenant_id,schedule_id,kind,title,source_anchor,source_zone,source_schedule_revision,source_filters,entry_count,user_count,elapsed_micros,creator_id,deleted_at)
select('a7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,tenant_id,schedule_id,kind,'Tombstone '||n,source_anchor,source_zone,source_schedule_revision,source_filters,entry_count,user_count,elapsed_micros,creator_id,now()from public.rota_period_templates cross join generate_series(1,499)n where tenant_id='a1000000-0000-4000-8000-000000000001';
insert into public.rota_period_entries(tenant_id,schedule_id,template_id,entry_index,source_shift_id,agent_id,job_id,snapshot)select e.tenant_id,e.schedule_id,('a7400000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,e.entry_index,e.source_shift_id,e.agent_id,e.job_id,e.snapshot from public.rota_period_entries e cross join generate_series(1,499)n where e.tenant_id='a1000000-0000-4000-8000-000000000001'and e.template_id=(select(v->>'template_id')::uuid from period_state where k='saved');
set role authenticated;
select pg_temp.period_check(public.read_rota_period_templates('a1000000-0000-4000-8000-000000000001','{"tenantId":"a1000000-0000-4000-8000-000000000001","scheduleId":"a2000000-0000-4000-8000-000000000001","kind":"day"}')->>'canEdit'='true','full metadataquota still permits title-only editing with operationbudget');
select pg_temp.period_check(pg_temp.period_source()->'saveBlockers'?'metadata_capacity','500 metadata including tombstones blocks new Save reviewtruthfully');
insert into period_state values('renamed',public.save_rota_period_template('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','rename','schedule_id','a2000000-0000-4000-8000-000000000001','schedule_revision',3,'template_id',(select v->'template_id'from period_state where k='saved'),'template_revision',1,'title','Renamed precise day')::text));
select pg_temp.period_check((select v->>'template_revision'='2'and v->>'schedule_revision'='4'and v->'generated'='[]'::jsonb from period_state where k='renamed'),'Rename title only advances exactlyone template/schedule revision despite fullmetadata');
reset role;
update public.rota_schedules set time_zone='America/Sao_Paulo'where id='a2000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.period_error($q$select pg_temp.period_source('{"sourceAnchor":"2018-11-04"}')$q$,'22023','source midnight gap explicitly rejects review rather than shifting boundary');
reset role;update public.rota_schedules set time_zone='America/Havana'where id='a2000000-0000-4000-8000-000000000001';set role authenticated;
select pg_temp.period_error($q$select pg_temp.period_source('{"sourceAnchor":"2026-11-01"}')$q$,'22023','source repeated midnight explicitly rejects guessed occurrence');
reset role;update public.rota_schedules set time_zone='Pacific/Apia'where id='a2000000-0000-4000-8000-000000000001';set role authenticated;
select pg_temp.period_error($q$select pg_temp.period_source('{"sourceAnchor":"2011-12-30"}')$q$,'22023','source skipped local boundary explicitly rejects review');
select pg_temp.period_check(pg_temp.period_source('{"kind":"week","sourceAnchor":"2011-12-26"}')->'source'->>'entryCount'='0','week with skipped interior date retains valid strictboundaries');
reset role;update public.rota_schedules set time_zone='UTC',status='archived'where id='a2000000-0000-4000-8000-000000000001';set role authenticated;
select pg_temp.period_check(public.reconcile_rota_period_template_operation('a1000000-0000-4000-8000-000000000001','a6000000-0000-4000-8000-000000000002','add','a2000000-0000-4000-8000-000000000001',(select(v->>'template_id')::uuid from period_state where k='saved'))->'saved'=(select v from period_state where k='added'),'archival never prevents current authorized recorded recovery');
select pg_temp.period_error($q$select public.save_rota_period_template('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','delete','schedule_id','a2000000-0000-4000-8000-000000000001','schedule_revision',4,'template_id',(select v->'template_id'from period_state where k='saved'),'template_revision',2)::text)$q$,'22023','archived schedule rejects new tombstone mutation');
reset role;update public.rota_schedules set status='active'where id='a2000000-0000-4000-8000-000000000001';
update public.agents set status='archived'where id='a3000000-0000-4000-8000-000000000001';
set role authenticated;
insert into period_state values('blocked_worker',pg_temp.period_target('{"templateRevision":2,"pageKind":"blocked","limit":1}'));
select pg_temp.period_check((select v->>'canAdd'='false'and v->>'blockedEntryCount'='1'and v->'entries'->0->'blockers'?'worker_unavailable'and v->'planDigest'=pg_temp.period_target('{"templateRevision":2,"pageKind":"entries"}')->'planDigest'from period_state where k='blocked_worker'),'unavailable assigned worker yields stable blocked fingerprint across diagnosticpages');
select pg_temp.period_error($q$select public.save_rota_period_template('a1000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','add','schedule_id','a2000000-0000-4000-8000-000000000001','schedule_revision',4,'template_id',(select v->'template_id'from period_state where k='saved'),'template_revision',2,'target_anchor','2026-11-02','occurrences','[]'::jsonb,'plan_digest',(select v->'planDigest'from period_state where k='blocked_worker'),'expected_entry_count',3,'allow_overlap',true)::text)$q$,'40001','blocked last-assignment wholebatch cannot skip or create anydraft');
reset role;
select pg_temp.period_check((select count(*)=0 from public.rota_shifts where schedule_id='a2000000-0000-4000-8000-000000000001')and(select count(*)=3 from public.rota_period_generated where tenant_id='a1000000-0000-4000-8000-000000000001'),'blocked wholebatch preserves deletedlive draftstate and retained history');
update public.agents set status='active'where id='a3000000-0000-4000-8000-000000000001';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980904',false);
select pg_temp.period_error($q$select pg_temp.period_target('{"templateRevision":2}')$q$,'42501','assigned employee visibility never authorizes period management');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980906',false);
select pg_temp.period_error($q$select pg_temp.period_source('{"scheduleRevision":4}')$q$,'42501','foreign owner cannot capture anothercompany sources');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000980901',false);
reset role;

-- Local and canonical UTC endpoints both remain in AD0001..9999.
select pg_temp.period_check(workforce_private.rota_period_endpoint(timestamp '0001-01-01 00:00','Etc/GMT-14','')->>'diagnostic'='unsupported_endpoint','target earlyUTC boundary never relabels BC as AD');
select pg_temp.period_check(workforce_private.rota_period_endpoint(timestamp '9999-12-31 23:00','Etc/GMT+12','')->>'diagnostic'='unsupported_endpoint','target UTCyear10000 returns stable supporteddiagnostic');
select pg_temp.period_check(workforce_private.rota_period_endpoint(timestamp '10000-01-01 00:00','Etc/GMT-14','')->>'diagnostic'='unsupported_endpoint','target carriedout localyear10000 rejected evenwhen UTCwouldremain9999');
select pg_temp.period_error($q$select workforce_private.rota_period_source_utc(timestamptz '9999-12-31 23:00+00','Etc/GMT-14')$q$,'22023','source localyear10000 explicitly rejected without precisioncoercion');
select pg_temp.period_error($q$select workforce_private.rota_period_utc((timestamptz '0001-01-01 00:00:00+00'-interval '1 second'))$q$,'22023','source originalBC provenance cannot serialize asAD');
