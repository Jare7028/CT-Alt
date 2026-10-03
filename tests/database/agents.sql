\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'FAIL: %', label; end if;
 raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.expect_error(command text, expected text, label text) returns void language plpgsql as $$
begin
 begin
  execute command;
 exception when others then
  if sqlstate <> expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm; end if;
  raise notice 'PASS: %',label; return;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end;
$$;
insert into auth.users(id,email_confirmed_at,is_anonymous) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,case when n=106 then null else now() end,n=107 from generate_series(101,108) n;
insert into public.tenants(id,name) values
 ('20000000-0000-0000-0000-000000000001','Synthetic Agents A'),
 ('20000000-0000-0000-0000-000000000002','Synthetic Agents B');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select
 '20000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||n,
 case n when 101 then 'owner' when 102 then 'admin' when 103 then 'manager' when 106 then 'admin' when 107 then 'admin' else 'employee' end from generate_series(101,107) n;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000108','Synthetic Owner B','owner'),
 ('20000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000102','Synthetic Shared Admin','employee');
insert into public.agent_fields(tenant_id,key,label,required) values
 ('20000000-0000-0000-0000-000000000001','client','Client',true);

select pg_temp.check_true((select count(*)=3 from pg_class where oid in ('public.agents'::regclass,'public.agent_fields'::regclass,'public.agent_audit'::regclass) and relrowsecurity),'RLS enabled on all Agents tables');
select pg_temp.check_true(not has_function_privilege('anon','public.save_agents(uuid,jsonb)','EXECUTE'),'anonymous cannot call mutations');
select pg_temp.check_true((select proconfig @> array['search_path=""'] from pg_proc where oid='workforce_private.save_agents(uuid,jsonb)'::regprocedure),'mutation definer has fixed search path');
do $$declare tbl text;op text;begin
 foreach tbl in array array['agents','agent_fields','agent_audit'] loop
  foreach op in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   perform pg_temp.check_true(not has_table_privilege('anon','public.'||tbl,op),'anonymous denied '||op||' on '||tbl);
   if op<>'SELECT' then perform pg_temp.check_true(not has_table_privilege('authenticated','public.'||tbl,op),'direct browser denied '||op||' on '||tbl); end if;
  end loop;
 end loop;
end;$$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Owner","last_name":"Synthetic","phone":"+447700900101","custom_fields":{"client":"Synthetic client"}},{"action":"create","first_name":"Admin","last_name":"Synthetic","phone":"+447700900102","custom_fields":{"client":"Synthetic client"}},{"action":"create","first_name":"Employee","last_name":"Synthetic","phone":"+447700900104","custom_fields":{"client":"Synthetic client"}}]');
select pg_temp.check_true((select count(*)=3 from public.agents),'owner creates batch');
select pg_temp.check_true((select count(*)=3 from public.agent_audit),'each creation has audit event');
select pg_temp.check_true((select bool_and(actor_user_id='00000000-0000-0000-0000-000000000101' and actor_name='Synthetic 101' and action='created' and revision=1) from public.agent_audit),'audit identity assigned by database');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Client","phone":"+447700900111","custom_fields":{}}]')$q$,'22023','company required Client enforced in database');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Unknown","last_name":"Field","phone":"+447700900111","custom_fields":{"client":"x","role":"owner"}}]')$q$,'22023','unknown custom field cannot grant permissions');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Fake","last_name":"Role","phone":"+447700900111","role":"owner","custom_fields":{"client":"x"}}]')$q$,'22023','role injection rejected');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","id":"30000000-0000-0000-0000-000000000001","first_name":"Fake","last_name":"ID","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'22023','caller cannot assign record ID');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[]')$q$,'22023','empty batch rejected');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Date","last_name":"Synthetic","phone":"+447700900198","employment_start_date":"infinity","custom_fields":{"client":"x"}}]')$q$,'22023','RPC rejects calendar date infinity');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Date","last_name":"Synthetic","phone":"+447700900198","employment_start_date":"-infinity","custom_fields":{"client":"x"}}]')$q$,'22023','RPC rejects calendar date -infinity');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Date","last_name":"Synthetic","phone":"+447700900198","employment_start_date":"10000-01-01","custom_fields":{"client":"x"}}]')$q$,'22023','RPC rejects calendar date 10000-01-01');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Date","last_name":"Synthetic","phone":"+447700900198","employment_start_date":"2026-02-30","custom_fields":{"client":"x"}}]')$q$,'22008','RPC rejects calendar date 2026-02-30');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Date","last_name":"Synthetic","phone":"+447700900198","employment_start_date":"10/03/2026","custom_fields":{"client":"x"}}]')$q$,'22023','RPC rejects calendar date 10/03/2026');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"  ","last_name":"Blank","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'23514','blank names rejected');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Bad","last_name":"Phone","phone":"07700","custom_fields":{"client":"x"}}]')$q$,'23514','noninternational phone rejected');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Good","last_name":"First","phone":"+447700900111","custom_fields":{"client":"x"}},{"action":"create","first_name":"Bad","last_name":"Second","phone":"07700","custom_fields":{"client":"x"}}]')$q$,'23514','invalid batch rolls back');
select pg_temp.check_true((select count(*)=3 from public.agents) and (select count(*)=3 from public.agent_audit),'failed batch leaves no records or audit events');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"Duplicate","last_name":"Phone","phone":"+447700900101","custom_fields":{"client":"x"}}]')$q$,'23505','phone unique within company');
select pg_temp.expect_error($q$update public.agents set title='Unauthorized'$q$,'42501','direct record writes rejected');
select pg_temp.expect_error($q$insert into public.agent_audit(tenant_id,agent_id,actor_name,action,revision) select tenant_id,id,'Impersonator','created',1 from public.agents limit 1$q$,'42501','caller cannot forge audit');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000002','[{"action":"create","first_name":"Cross","last_name":"Company","phone":"+447700900111","custom_fields":{}}]')$q$,'42501','owner cannot create in foreign company');

reset role;
update public.agents set user_id='00000000-0000-0000-0000-000000000101' where phone='+447700900101';
update public.agents set user_id='00000000-0000-0000-0000-000000000102' where phone='+447700900102';
update public.agents set user_id='00000000-0000-0000-0000-000000000104' where phone='+447700900104';
select pg_temp.expect_error($q$update public.agents set user_id='00000000-0000-0000-0000-000000000101' where phone='+447700900102'$q$,'23505','one Auth identity cannot link to multiple company agents');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000108',false);
select public.save_agents('20000000-0000-0000-0000-000000000002','[{"action":"create","first_name":"Foreign","last_name":"Company","phone":"+447700900101","custom_fields":{}}]');
select pg_temp.check_true((select count(*)=1 from public.agents),'foreign owner reads only own company; same phone permitted in separate company');
select pg_temp.check_true((select count(*)=0 from public.agent_fields),'foreign company cannot read required field configuration');
select pg_temp.check_true((select count(*)=1 from public.agent_audit),'foreign audit isolated');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',false);
select pg_temp.check_true((select count(*)=3 from public.agents),'admin sees own company directory and no unlinked foreign rows');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000002','[{"action":"create","first_name":"Wrong","last_name":"Role","phone":"+447700900111","custom_fields":{}}]')$q$,'42501','company A admin cannot borrow role in company B');
select public.save_agents('20000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('action','update','id',(select id from public.agents where phone='+447700900104'),'revision',1,'first_name','Employee','last_name','Updated','phone','+447700900104','custom_fields',jsonb_build_object('client','x'))));
select pg_temp.check_true((select revision=2 and last_name='Updated' from public.agents where phone='+447700900104'),'admin updates record and increments revision');
select pg_temp.expect_error(format($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"archive","id":"%s","revision":1}]')$q$,(select id from public.agents where phone='+447700900104')),'40001','stale revision prevents lost update');
select pg_temp.expect_error(format($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"archive","id":"%s","revision":1}]')$q$,(select id from public.agents where phone='+447700900102')),'42501','self archive blocked');
select pg_temp.expect_error(format($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"archive","id":"%s","revision":1}]')$q$,(select id from public.agents where phone='+447700900101')),'42501','owner archive blocked');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000103',false);
select pg_temp.check_true((select count(*)=3 from public.agents),'manager can read own company directory');
select pg_temp.check_true((select count(*)=0 from public.agent_audit),'manager cannot read audit');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Permission","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','manager cannot write');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000104',false);
select pg_temp.check_true((select count(*)=1 from public.agents),'employee can read only own linked active record');
select pg_temp.check_true((select count(*)=0 from public.agent_audit),'employee cannot read audit');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Permission","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','employee cannot write');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000105',false);
select pg_temp.check_true((select count(*)=0 from public.agents),'unlinked employee cannot read directory');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000106',false);
select pg_temp.check_true((select count(*)=0 from public.agents),'unconfirmed admin cannot read');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Confirmation","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','unconfirmed admin cannot write');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000107',false);
select pg_temp.check_true((select count(*)=0 from public.agents),'anonymous Auth identity cannot read');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Anonymous","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','anonymous Auth admin cannot write');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Identity","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','missing identity cannot write');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select public.save_agents('20000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('action','archive','id',(select id from public.agents where phone='+447700900102'),'revision',1)));
select pg_temp.check_true((select status='archived' and revision=2 from public.agents where phone='+447700900102'),'archive retains record and advances revision');
select pg_temp.check_true((select status='suspended' from public.tenant_memberships where user_id='00000000-0000-0000-0000-000000000102' and tenant_id='20000000-0000-0000-0000-000000000001'),'archive suspends linked membership');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',false);
select pg_temp.check_true((select count(*)=0 from public.agents),'existing token loses company data access after archive');
select pg_temp.check_true((select count(*)=1 from public.tenants),'archived user retains separate company membership');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"Suspended","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','existing token loses write access after archive');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select public.save_agents('20000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('action','restore','id',(select id from public.agents where phone='+447700900102'),'revision',2)));
select pg_temp.check_true((select status='active' and role='employee' from public.tenant_memberships where user_id='00000000-0000-0000-0000-000000000102' and tenant_id='20000000-0000-0000-0000-000000000001'),'restored admin becomes ordinary employee');
select pg_temp.check_true((select count(*)=6 from public.agent_audit),'update archive restore audit events retained');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000102',false);
select pg_temp.check_true((select count(*)=1 from public.agents),'restored employee reads only own record');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"RestoredAdmin","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','restoring admin does not restore write permissions');
reset role;
update public.tenants set status='suspended' where id='20000000-0000-0000-0000-000000000001';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000101',false);
select pg_temp.check_true((select count(*)=0 from public.agents),'company suspension hides all records');
select pg_temp.expect_error($q$select public.save_agents('20000000-0000-0000-0000-000000000001','[{"action":"create","first_name":"No","last_name":"CompanySuspended","phone":"+447700900111","custom_fields":{"client":"x"}}]')$q$,'42501','company suspension denies mutations');
reset role;

select pg_temp.expect_error($q$update public.agents set employment_start_date='infinity'::date$q$,'23514','finite calendar date constraint applies to privileged writes');
select pg_temp.expect_error($q$update public.agents set employment_start_date='10000-01-01'::date$q$,'23514','calendar date constraint rejects expanded years');
