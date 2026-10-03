\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end;$$;
create function pg_temp.expect_error(command text,expected text,label text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end;$$;
create function pg_temp.review(agent uuid default null,page_size integer default 50,after_row jsonb default null,export_rows boolean default false) returns jsonb language sql as $$select public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-25','2026-10-25',agent,page_size,after_row,export_rows)$$;
select pg_temp.check_true((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean)'::regprocedure),'team reader is stable invoker with empty search path');
select pg_temp.check_true(has_function_privilege('authenticated','public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean)','execute') and not has_function_privilege('anon','public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean)','execute') and not has_function_privilege('service_role','public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean)','execute'),'team reader execute is authenticated-only');
select pg_temp.check_true((select not exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') from pg_proc where oid='public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean)'::regprocedure),'PUBLIC cannot execute team reader');
select pg_temp.check_true((select qual like '%SELECT auth.uid()%' from pg_policies where schemaname='public' and tablename='time_clock_entries' and policyname='time_clock_entries_read'),'additive policy hoists identity without replacing the baseline');
select pg_temp.check_true(to_regclass('public.time_clock_completion_version') is not null,'tenant completion-version lookup has a scoped partial index');

-- Policy review after the additive migration: current identity is authoritative.
set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000304';
select pg_temp.check_true((select count(*)=1 from public.time_clock_entries where id='80000000-0000-0000-0000-000000000003'),'employee still reads its own known retained entry');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000305';
select pg_temp.check_true((select count(*)=0 from public.time_clock_entries where id='80000000-0000-0000-0000-000000000003'),'known coworker UUID cannot bypass optimized policy');
select pg_temp.expect_error($q$select public.save_time_clock('60000000-0000-0000-0000-000000000001',gen_random_uuid(),'{"action":"clock_out","entryId":"80000000-0000-0000-0000-000000000003","revision":1}')$q$,'P0002','known coworker UUID cannot be mutated after additive policy');
reset role;begin;
update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000304';set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000304';
select pg_temp.check_true((select count(*)=0 from public.time_clock_entries),'suspended current member loses direct entry reads');rollback;
begin;update public.agents set user_id=null where phone='+447700900304';
insert into public.agents(tenant_id,user_id,first_name,last_name,phone,created_by) values('60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000304','Replacement','Synthetic','+447700900349','00000000-0000-0000-0000-000000000301');
set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000304';
select pg_temp.check_true((select count(*)=0 from public.time_clock_entries),'relinked current identity cannot read earlier-agent history');rollback;
begin;update public.tenant_memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000302';
set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000302';
select pg_temp.check_true((select count(*)=0 from public.time_clock_entries where id='80000000-0000-0000-0000-000000000003'),'current admin-role revocation removes known coworker reads');
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','current admin-role revocation denies team reader before returning records');rollback;

-- Bigint audit version is text throughout, including values above JS precision.
insert into public.time_clock_audit(id,tenant_id,actor_user_id,job_id,entry_id,operation_id,action,revision) overriding system value
select 9007199254740993,'60000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000301',job_id,id,gen_random_uuid(),'clock_out',1 from public.time_clock_entries where id='80000000-0000-0000-0000-000000000003';
select setval('public.time_clock_audit_id_seq',9007199254740993);
insert into public.time_clock_entries(tenant_id,agent_id,job_id,agent_name,job_name,started_at)
select tenant_id,id,(select id from public.time_clock_jobs where name='Race'),'Synthetic unfinished','Race','2026-10-25T02:00:00Z' from public.agents where phone='+447700900305';
set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';
select pg_temp.check_true(pg_temp.review()->'summary'='{"entryCount":3,"agentCount":1,"elapsedSeconds":30600.123456,"unpaidBreakSeconds":900,"paidSeconds":29700.123456}'::jsonb,'owner summary is exact for all completed scope, including paid/unpaid break math and overnight start date');
select pg_temp.check_true(pg_temp.review()->>'datasetVersion'='9007199254740993','dataset version preserves bigint text');
select pg_temp.check_true((pg_temp.review(null,1)->'summary')=(pg_temp.review(null,100)->'summary'),'summary is independent of page size');
select pg_temp.check_true(pg_temp.review(null,1)->'entries'->0->>'id'='80000000-0000-0000-0000-000000000003','first page uses descending identity for equal timestamps');
select pg_temp.check_true(pg_temp.review(null,1)->'nextCursor'->>'startedAt'='2026-10-25T01:30:00.123456+00:00','cursor retains timestamp microseconds');
select pg_temp.check_true(pg_temp.review(null,1,pg_temp.review(null,1)->'nextCursor')->'entries'->0->>'id'='80000000-0000-0000-0000-000000000002','next page preserves microseconds and UUID keyset without duplicates');
select pg_temp.check_true(jsonb_array_length(pg_temp.review(null,1,null,true)->'entries')=3 and pg_temp.review(null,1,null,true)->'nextCursor'='null'::jsonb,'export contains entire selected scope independent of page size');
select pg_temp.check_true(not exists(select 1 from jsonb_array_elements(pg_temp.review(null,1,null,true)->'entries') e where e->>'ended_at' is null),'review/summary/export exclude unfinished entries in the selected range');
select pg_temp.expect_error($q$select pg_temp.review(null,101)$q$,'22023','page size bound enforced in database');
select pg_temp.expect_error($q$select public.read_team_timesheets('60000000-0000-0000-0000-000000000001','infinity','2026-10-25')$q$,'22023','infinite selected date denied');
select pg_temp.expect_error($q$select public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-26','2026-10-25')$q$,'22023','reversed selected dates denied');
select pg_temp.expect_error($q$select public.read_team_timesheets('60000000-0000-0000-0000-000000000002','2026-10-25','2026-10-25')$q$,'42501','owner cannot borrow foreign tenant history');
select pg_temp.expect_error($q$select pg_temp.review(null,1,pg_temp.review(null,1)->'nextCursor',true)$q$,'22023','export refuses a partial-page cursor');
select pg_temp.expect_error($q$select pg_temp.review(null,1,jsonb_set(pg_temp.review(null,1)->'nextCursor','{datasetVersion}','"1"'))$q$,'40001','changed completion version refuses page mixing');
select pg_temp.expect_error($q$select public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-24','2026-10-24',null,1,pg_temp.review(null,1)->'nextCursor')$q$,'22023','cursor binds exact inclusive date scope');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000302';
select pg_temp.check_true((pg_temp.review()->'summary'->>'entryCount')::integer=3,'admin can review all team entries');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000303';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','manager cannot review team timesheets');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000304';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','employee cannot review team timesheets');
set request.jwt.claim.sub='00000000-0000-0000-0000-000000000306';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','foreign owner cannot review team timesheets');
set request.jwt.claim.sub='';select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','missing signed identity denied');reset role;
begin;update public.tenant_memberships set role='admin' where user_id='00000000-0000-0000-0000-000000000308';set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000308';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','unconfirmed admin denied');rollback;
begin;update auth.users set is_anonymous=true where id='00000000-0000-0000-0000-000000000302';set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000302';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','anonymous identity with admin membership denied');rollback;
begin;update public.tenants set status='suspended' where id='60000000-0000-0000-0000-000000000001';set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';
select pg_temp.expect_error($q$select pg_temp.review()$q$,'42501','suspended company denies owner');rollback;
begin;update public.agents set status='archived',first_name='Renamed' where phone='+447700900304';update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000304';set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';
select pg_temp.check_true(pg_temp.review()->'agents'->0->>'name'='Synthetic 304' and (pg_temp.review()->'summary'->>'entryCount')::integer=3,'owner retains stored historical names for archived agents and suspended memberships');
select pg_temp.check_true((pg_temp.review((select id from public.agents where phone='+447700900304'))->'summary'->>'entryCount')::integer=3,'historical agent filter remains available to owner');rollback;
begin;create policy team_test_restrictive on public.time_clock_entries as restrictive for select to authenticated using(false);
set local role authenticated;set local request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';
select pg_temp.check_true(pg_temp.review()->'summary'->>'entryCount'='0' and jsonb_array_length(pg_temp.review()->'entries')=0,'team invoker aggregate obeys restrictive entry RLS');rollback;

-- Exact counts over the directory cap and complete bounded export at its limit.
insert into public.time_clock_entries(id,tenant_id,agent_id,job_id,agent_name,job_name,started_at,ended_at)
select ('81000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'60000000-0000-0000-0000-000000000001',
(select id from public.agents where phone='+447700900304'),(select id from public.time_clock_jobs where name='Care'),'Synthetic retained worker','Care','2026-10-15T09:00:00Z','2026-10-15T10:00:00Z' from generate_series(1,10000)n;
set role authenticated;set request.jwt.claim.sub='00000000-0000-0000-0000-000000000301';
select pg_temp.check_true(public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-15','2026-10-15')->'summary'='{"entryCount":10000,"agentCount":1,"elapsedSeconds":36000000,"unpaidBreakSeconds":0,"paidSeconds":36000000}'::jsonb,'summary counts and totals are exact above 1000');
select pg_temp.check_true(jsonb_array_length(public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-15','2026-10-15',null,1,null,true)->'entries')=10000,'export succeeds with all 10000 scoped records, never only a displayed page');
reset role;insert into public.time_clock_entries(tenant_id,agent_id,job_id,agent_name,job_name,started_at,ended_at)
select tenant_id,agent_id,job_id,agent_name,job_name,started_at,ended_at from public.time_clock_entries where id='81000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.expect_error($q$select public.read_team_timesheets('60000000-0000-0000-0000-000000000001','2026-10-15','2026-10-15',null,50,null,true)$q$,'54000','export refuses 10001 matches rather than returning incomplete CSV');
reset role;
