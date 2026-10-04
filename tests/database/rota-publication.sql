\set ON_ERROR_STOP on
-- Disposable local fixture only; IDs differ from retained 810-series upgrade rows.
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(970901,970906)n;
insert into public.tenants(id,name,time_zone) values('91000000-0000-4000-8000-000000000001','Synthetic publication A','Europe/London'),('91000000-0000-4000-8000-000000000002','Synthetic publication B','UTC');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select '91000000-0000-4000-8000-000000000001',('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||n,case n when 970901 then 'owner' when 970902 then 'admin' when 970903 then 'manager' when 970905 then 'manager' else 'employee' end from generate_series(970901,970905)n;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values('91000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000970906','Foreign','owner');
insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,created_by) values
('93000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000970904','Synthetic','Linked','+447700970904','00000000-0000-4000-8000-000000970901'),
('93000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001',null,'Synthetic','Directory','+447700970999','00000000-0000-4000-8000-000000970901'),
('93000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002','00000000-0000-4000-8000-000000970906','Synthetic','Foreign','+447700970906','00000000-0000-4000-8000-000000970906');
insert into public.rota_schedules(id,tenant_id,name,time_zone) values
('92000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','Publication main','Europe/London'),
('92000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','Publication other','UTC'),
('92000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002','Publication foreign','UTC');
insert into public.rota_agents values
('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001'),
('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002'),
('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001'),
('91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003');
insert into public.rota_admins values('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000970903');
insert into public.rota_jobs(id,tenant_id,schedule_id,name,color) values
('94000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','Publication visits','#3487ee'),
('94000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','Other visits','#3487ee'),
('94000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','Foreign visits','#3487ee');
insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title) values
('95000000-0000-4000-8000-000000000001','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','2026-10-24T22:00:00Z','2026-10-25T07:00:00Z','Overnight selected'),
('95000000-0000-4000-8000-000000000002','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001','2026-10-24T08:00:00Z','2026-10-24T16:00:00Z','Directory selected'),
('95000000-0000-4000-8000-000000000003','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000001','2026-11-24T08:00:00Z','2026-11-24T16:00:00Z','Outside selection'),
('95000000-0000-4000-8000-000000000004','91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000002','93000000-0000-4000-8000-000000000001','94000000-0000-4000-8000-000000000002','2026-11-25T08:00:00Z','2026-11-25T16:00:00Z','Other schedule'),
('95000000-0000-4000-8000-000000000005','91000000-0000-4000-8000-000000000002','92000000-0000-4000-8000-000000000003','93000000-0000-4000-8000-000000000003','94000000-0000-4000-8000-000000000003','2026-11-25T08:00:00Z','2026-11-25T16:00:00Z','Foreign schedule');
create function pg_temp.publication_check(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end;$$;
create function pg_temp.publication_error(command text,expected text,label text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end;$$;
create function pg_temp.pub(rows jsonb default '[{"id":"95000000-0000-4000-8000-000000000001","revision":1},{"id":"95000000-0000-4000-8000-000000000002","revision":1}]',rev integer default 1) returns jsonb language sql as $$select public.publish_rota_shifts('91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001',rev,rows)$$;
select pg_temp.publication_check(not has_function_privilege('anon','public.publish_rota_shifts(uuid,uuid,integer,jsonb)','EXECUTE') and not has_function_privilege('service_role','public.publish_rota_shifts(uuid,uuid,integer,jsonb)','EXECUTE'),'publication wrapper denies anon and service role');
select pg_temp.publication_check(not has_function_privilege('anon','workforce_private.publish_rota_shifts(uuid,uuid,integer,jsonb)','EXECUTE') and not has_function_privilege('service_role','workforce_private.publish_rota_shifts(uuid,uuid,integer,jsonb)','EXECUTE'),'publication definer denies anon and service role');
select pg_temp.publication_check((select not prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='public.publish_rota_shifts(uuid,uuid,integer,jsonb)'::regprocedure),'public publication wrapper is empty-path invoker');
select pg_temp.publication_check((select prosecdef and proconfig=array['search_path=""'] from pg_proc where oid='workforce_private.publish_rota_shifts(uuid,uuid,integer,jsonb)'::regprocedure),'private publication writer is empty-path definer');
select pg_temp.publication_check(not has_table_privilege('authenticated','public.rota_shifts','UPDATE'),'publication adds no direct shift writes');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970901',false);
select pg_temp.publication_error($q$select pg_temp.pub('[]')$q$,'22023','empty subset rejected');
select pg_temp.publication_error($q$select pg_temp.pub('{}')$q$,'22023','nonarray subset rejected');
select pg_temp.publication_error($q$select pg_temp.pub(null)$q$,'22023','null subset rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1,"extra":true}]')$q$,'22023','extra target fields rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"bad","revision":1}]')$q$,'22023','malformed UUID rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":"1"}]')$q$,'22023','string revision rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1.5}]')$q$,'22023','fractional revision rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":2147483647}]')$q$,'22023','shift revision overflow rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1},{"id":"95000000-0000-4000-8000-000000000001","revision":1}]')$q$,'22023','duplicate target rejected');
select pg_temp.publication_error($q$select pg_temp.pub((select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'revision',1)) from generate_series(1,5001)))$q$,'22023','5001st target rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1}]',2147483647)$q$,'22023','schedule revision overflow rejected');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1}]',2)$q$,'40001','stale schedule rejects subset');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":2}]')$q$,'40001','stale shift rejects subset');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1},{"id":"95000000-0000-4000-8000-000000000004","revision":1}]')$q$,'40001','mixed schedule rejects entire subset');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1},{"id":"95000000-0000-4000-8000-000000000005","revision":1}]')$q$,'40001','mixed company rejects entire subset');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000001","revision":1},{"id":"95000000-0000-4000-8000-000000000099","revision":1}]')$q$,'40001','missing target rejects entire subset');
select pg_temp.publication_check((select bool_and(status='draft' and revision=1 and published_at is null) from public.rota_shifts where tenant_id='91000000-0000-4000-8000-000000000001'),'invalid batches leave every draft unchanged');
select pg_temp.publication_check((select count(*)=0 from public.rota_audit where tenant_id='91000000-0000-4000-8000-000000000001'),'invalid batches create no audit');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970904',false);
select pg_temp.publication_error('select pg_temp.pub()','42501','employee cannot publish');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970905',false);
select pg_temp.publication_error('select pg_temp.pub()','42501','undelegated manager cannot publish');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970906',false);
select pg_temp.publication_error('select pg_temp.pub()','42501','foreign owner cannot publish');
reset role;
update public.agents set status='archived' where id='93000000-0000-4000-8000-000000000002';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970901',false);
select pg_temp.publication_error('select pg_temp.pub()','23503','one inactive directory worker rejects whole subset');
reset role;update public.agents set status='active' where id='93000000-0000-4000-8000-000000000002';
update public.tenant_memberships set status='suspended' where user_id='00000000-0000-4000-8000-000000970904';
set role authenticated;
select pg_temp.publication_error('select pg_temp.pub()','23503','one suspended linked membership rejects whole subset');
reset role;update public.tenant_memberships set status='active' where user_id='00000000-0000-4000-8000-000000970904';
update public.rota_schedules set status='archived' where id='92000000-0000-4000-8000-000000000001';
set role authenticated;
select pg_temp.publication_error('select pg_temp.pub()','22023','archived schedule rejects subset');
reset role;update public.rota_schedules set status='active' where id='92000000-0000-4000-8000-000000000001';
update auth.users set email_confirmed_at=null where id='00000000-0000-4000-8000-000000970901';
set role authenticated;
select pg_temp.publication_error('select pg_temp.pub()','42501','current unconfirmed actor rejected');
reset role;update auth.users set email_confirmed_at=now() where id='00000000-0000-4000-8000-000000970901';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970903',false);
create temp table publication_ack(v jsonb);insert into publication_ack values(pg_temp.pub());
select pg_temp.publication_check((select v->>'actorId'='00000000-0000-4000-8000-000000970903' and v->>'tenantId'='91000000-0000-4000-8000-000000000001' and v->>'schedule_id'='92000000-0000-4000-8000-000000000001' and v->>'schedule_revision'='2' and v->>'published_count'='2' and jsonb_array_length(v->'shifts')=2 from publication_ack),'delegated manager gets exact scoped count and one schedule revision');
select pg_temp.publication_check((select bool_and(status='published' and published_at is not null and revision=2) and count(*)=2 from public.rota_shifts where id in('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002')),'only selected draft revisions advance');
select pg_temp.publication_check((select bool_and(status='draft' and revision=1 and published_at is null) from public.rota_shifts where tenant_id='91000000-0000-4000-8000-000000000001' and id not in('95000000-0000-4000-8000-000000000001','95000000-0000-4000-8000-000000000002')),'outside selection and other schedule remain drafts');
select pg_temp.publication_check((select count(*)=1 and bool_and(action='publish' and revision=2) from public.rota_audit where schedule_id='92000000-0000-4000-8000-000000000001'),'one existing publish audit records subset operation');
select pg_temp.publication_error($q$select pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000003","revision":1},{"id":"95000000-0000-4000-8000-000000000001","revision":2}]',2)$q$,'40001','published target rejects all remaining drafts');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970904',false);
select pg_temp.publication_check((select count(*)=1 from public.rota_shifts where schedule_id='92000000-0000-4000-8000-000000000001'),'employee sees only own selected published shift');
select pg_temp.publication_check((select count(*)=0 from public.rota_shifts where title in('Directory selected','Outside selection','Other schedule','Foreign schedule')),'employee never sees coworker or remaining drafts');
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000970902',false);
select pg_temp.publication_check(pg_temp.pub('[{"id":"95000000-0000-4000-8000-000000000003","revision":1}]',2)->>'published_count'='1','admin can publish exact remaining subset');
reset role;
-- Whole-bound batch proves no truncation or silently split partial publication.
insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title)
select ('97000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'91000000-0000-4000-8000-000000000001','92000000-0000-4000-8000-000000000001','93000000-0000-4000-8000-000000000002','94000000-0000-4000-8000-000000000001',timestamptz '2030-01-01 00:00Z'+n*interval '2 hours',timestamptz '2030-01-01 01:00Z'+n*interval '2 hours','Bulk publication fixture' from generate_series(1,5000)n;
set role authenticated;
create temp table publication_bulk_ack(v jsonb);
insert into publication_bulk_ack select pg_temp.pub(jsonb_agg(jsonb_build_object('id',id,'revision',revision)),3) from public.rota_shifts where title='Bulk publication fixture';
select pg_temp.publication_check((select v->>'published_count'='5000' and jsonb_array_length(v->'shifts')=5000 and v->>'schedule_revision'='4' from publication_bulk_ack),'exact 5000 targets publish in one acknowledgement');
select pg_temp.publication_check((select count(*)=5000 and bool_and(status='published' and revision=2 and published_at is not null) from public.rota_shifts where title='Bulk publication fixture'),'5000-target bound never truncates or partially commits');
select pg_temp.publication_check((select count(*)=1 from public.rota_audit where schedule_id='92000000-0000-4000-8000-000000000001' and revision=4),'5000-target batch records exactly one existing publish audit');
reset role;
delete from public.rota_shifts where tenant_id='91000000-0000-4000-8000-000000000001' and title='Bulk publication fixture';
-- Restore these owned synthetic drafts for the genuine concurrency suite.
update public.rota_shifts set status='draft',published_at=null,revision=1 where tenant_id='91000000-0000-4000-8000-000000000001';
update public.rota_schedules set revision=1 where tenant_id='91000000-0000-4000-8000-000000000001';
delete from public.rota_audit where tenant_id='91000000-0000-4000-8000-000000000001';
