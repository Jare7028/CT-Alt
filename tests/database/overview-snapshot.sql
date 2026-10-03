\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin
 if ok is distinct from true then raise exception 'FAIL: %', label; end if;
 raise notice 'PASS: %', label;
end;
$$;
create function pg_temp.expect_error(command text, expected text, label text) returns void language plpgsql as $$
begin
 begin execute command;
 exception when others then
  if sqlstate <> expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm; end if;
  raise notice 'PASS: %',label; return;
 end;
 raise exception 'FAIL: % unexpectedly succeeded',label;
end;
$$;

-- Only synthetic fixtures. The first company exceeds the API's row limit.
insert into auth.users(id,email_confirmed_at,is_anonymous)
select ('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 case when n=7 then null else now() end,n=8 from generate_series(1,1210) n;
insert into public.tenants(id,name,status) values
 ('72000000-0000-4000-8000-000000000001','Synthetic overview A','active'),
 ('72000000-0000-4000-8000-000000000002','Synthetic overview B','active'),
 ('72000000-0000-4000-8000-000000000003','Synthetic overview suspended','suspended'),
 ('72000000-0000-4000-8000-000000000004','Synthetic overview empty','active');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role,status)
select '72000000-0000-4000-8000-000000000001',id,'Synthetic '||n,
 case when n=1 then 'owner' when n in (2,7,8,9) then 'admin' when n=3 then 'manager' else 'employee' end,
 case when n=9 then 'suspended' else 'active' end
from (select n,('71000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid id from generate_series(1,1209) n) f
where n<>6;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values
 ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000006','Synthetic B owner','owner'),
 ('72000000-0000-4000-8000-000000000002','71000000-0000-4000-8000-000000000002','Synthetic B employee','employee'),
 ('72000000-0000-4000-8000-000000000003','71000000-0000-4000-8000-000000000001','Synthetic suspended owner','owner'),
 ('72000000-0000-4000-8000-000000000004','71000000-0000-4000-8000-000000000001','Synthetic empty owner','owner');
insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,status,created_by)
select ('73000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
 '72000000-0000-4000-8000-000000000001',
 case when n<=1003 then ('71000000-0000-4000-8000-'||lpad((n+10)::text,12,'0'))::uuid else null end,
 'Synthetic','Agent '||n,'+4477'||lpad(n::text,8,'0'),
 case when n<=1204 then 'active' else 'archived' end,'71000000-0000-4000-8000-000000000001'
from generate_series(1,1221) n;
insert into public.agents(tenant_id,first_name,last_name,phone,created_by)
values ('72000000-0000-4000-8000-000000000002','Synthetic','Foreign','+447700999999','71000000-0000-4000-8000-000000000006');

select pg_temp.check_true((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.read_workforce_overview(uuid)'::regprocedure),'snapshot RPC is stable invoker with an empty search path');
select pg_temp.check_true(has_function_privilege('authenticated','public.read_workforce_overview(uuid)','EXECUTE'),'signed users can execute snapshot RPC');
select pg_temp.check_true(not has_function_privilege('anon','public.read_workforce_overview(uuid)','EXECUTE'),'anonymous cannot execute snapshot RPC');
select pg_temp.check_true(not has_function_privilege('service_role','public.read_workforce_overview(uuid)','EXECUTE'),'privileged application role receives no snapshot RPC grant');
select pg_temp.check_true((select not exists(select 1 from aclexplode(proacl) where grantee=0 and privilege_type='EXECUTE') from pg_proc where oid='public.read_workforce_overview(uuid)'::regprocedure),'PUBLIC cannot execute snapshot RPC');
select pg_temp.check_true(not has_table_privilege('authenticated','public.agents','UPDATE') and not has_table_privilege('authenticated','public.tenant_memberships','UPDATE'),'snapshot grants do not allow signed-user table writes');

set role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',false);
select pg_temp.check_true(public.read_workforce_overview('72000000-0000-4000-8000-000000000001') =
 '{"agents":{"active":1204,"archived":17,"linked":1003,"unlinked":201},"memberships":{"owner":1,"admin":3,"manager":1,"employee":1202}}'::jsonb,
 'owner sees exact counts above 1000, includes only active memberships and excludes foreign records');
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000002')$q$,'42501','owner cannot read foreign company');
select pg_temp.check_true(public.read_workforce_overview('72000000-0000-4000-8000-000000000004') =
 '{"agents":{"active":0,"archived":0,"linked":0,"unlinked":0},"memberships":{"owner":1,"admin":0,"manager":0,"employee":0}}'::jsonb,'authorized empty company returns exact zero directory counts');
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000003')$q$,'42501','suspended company denies its owner');
select pg_temp.expect_error($q$select public.read_workforce_overview(null)$q$,'42501','null company denies access');
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000099')$q$,'42501','unknown company denies access');
do $$declare n integer; payload jsonb;begin
 foreach n in array array[2,3] loop
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-'||lpad(n::text,12,'0'),false);
  payload := public.read_workforce_overview('72000000-0000-4000-8000-000000000001');
  perform pg_temp.check_true(payload->'agents' = '{"active":1204,"archived":17,"linked":1003,"unlinked":201}'::jsonb,'admin/manager receive exact directory counts: '||n);
 end loop;
 foreach n in array array[4,5,6,7,8,9,1210] loop
  perform set_config('request.jwt.claim.sub','71000000-0000-4000-8000-'||lpad(n::text,12,'0'),false);
  perform pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000001')$q$,'42501','employee/foreign/unconfirmed/anonymous/suspended/nonmember denied: '||n);
 end loop;
end;$$;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000002',false);
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000002')$q$,'42501','admin cannot borrow its role in another company where it is an employee');
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000006',false);
select pg_temp.check_true(public.read_workforce_overview('72000000-0000-4000-8000-000000000002') =
 '{"agents":{"active":1,"archived":0,"linked":0,"unlinked":1},"memberships":{"owner":1,"admin":0,"manager":0,"employee":1}}'::jsonb,'foreign owner sees only its own tenant');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000001')$q$,'42501','missing signed identity is denied');
reset role;
set role anon;
select pg_temp.expect_error($q$select public.read_workforce_overview('72000000-0000-4000-8000-000000000001')$q$,'42501','anonymous invocation is denied by execute ACL');
reset role;

-- Prove RLS stays authoritative even when the caller's role lookup succeeds.
begin;
create policy overview_test_restrictive on public.agents as restrictive for select to authenticated using (false);
set local role authenticated;
select set_config('request.jwt.claim.sub','71000000-0000-4000-8000-000000000001',true);
select pg_temp.check_true(public.read_workforce_overview('72000000-0000-4000-8000-000000000001')->'agents' =
 '{"active":0,"archived":0,"linked":0,"unlinked":0}'::jsonb,'invoker aggregate obeys restrictive RLS instead of bypassing it');
rollback;
