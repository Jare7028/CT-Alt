\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean, label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'FAIL: %', label; end if;
  raise notice 'PASS: %', label;
end;
$$;

insert into auth.users(id, email_confirmed_at, is_anonymous) values
 ('00000000-0000-0000-0000-000000000001', now(), false),
 ('00000000-0000-0000-0000-000000000002', now(), false),
 ('00000000-0000-0000-0000-000000000003', now(), false),
 ('00000000-0000-0000-0000-000000000004', null, false),
 ('00000000-0000-0000-0000-000000000005', now(), true),
 ('00000000-0000-0000-0000-000000000006', now(), false);
insert into public.tenants(id, name, time_zone) values
 ('10000000-0000-0000-0000-000000000001', 'Synthetic Company A', 'Europe/London'),
 ('10000000-0000-0000-0000-000000000002', 'Synthetic Company B', 'America/New_York');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Owner A','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','Shared Member','employee'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000002','Shared Member','manager'),
 ('10000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','Owner B','owner'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000004','Unconfirmed','employee'),
 ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000005','Anonymous','employee');

select pg_temp.check_true((select count(*)=2 from pg_class where oid in ('public.tenants'::regclass,'public.tenant_memberships'::regclass) and relrowsecurity), 'RLS enabled on both tables');
select pg_temp.check_true(not has_schema_privilege('anon','workforce_private','USAGE'), 'anonymous role cannot access private helpers');
select pg_temp.check_true(not has_function_privilege('anon','workforce_private.membership_role(uuid)','EXECUTE'), 'anonymous role cannot execute role lookup');
select pg_temp.check_true((select proconfig @> array['search_path=""'] from pg_proc where oid='workforce_private.membership_role(uuid)'::regprocedure), 'definer has fixed empty search_path');

do $$
declare tbl text; op text;
begin
 foreach tbl in array array['tenants','tenant_memberships'] loop
  foreach op in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   perform pg_temp.check_true(not has_table_privilege('anon','public.'||tbl,op), 'anonymous denied '||op||' on '||tbl);
   if op <> 'SELECT' then
    perform pg_temp.check_true(not has_table_privilege('authenticated','public.'||tbl,op), 'browser denied '||op||' on '||tbl);
   end if;
  end loop;
 end loop;
end;
$$;

set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000001',false);
select pg_temp.check_true((select count(*)=1 from public.tenants), 'owner reads only company A');
select pg_temp.check_true((select count(*)=4 from public.tenant_memberships), 'owner reads own company memberships');
select pg_temp.check_true((select count(*)=0 from public.tenants where id='10000000-0000-0000-0000-000000000002'), 'foreign company ID returns no rows');
select pg_temp.check_true(workforce_private.membership_role('10000000-0000-0000-0000-000000000002') is null, 'foreign role lookup returns null');
do $$
begin
 begin
  update public.tenant_memberships set role='owner';
  raise exception 'Unexpected membership write';
 exception when insufficient_privilege then raise notice 'PASS: direct membership update rejected'; end;
 begin
  insert into public.tenants(name) values ('Unauthorized');
  raise exception 'Unexpected company creation';
 exception when insufficient_privilege then raise notice 'PASS: direct company creation rejected'; end;
end;
$$;

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select pg_temp.check_true((select count(*)=2 from public.tenants), 'same user can join two companies');
select pg_temp.check_true((select count(*)=1 from public.tenant_memberships where tenant_id='10000000-0000-0000-0000-000000000001'), 'employee sees only own membership');
select pg_temp.check_true((select count(*)=2 from public.tenant_memberships where tenant_id='10000000-0000-0000-0000-000000000002'), 'manager sees own company directory');
select pg_temp.check_true(workforce_private.membership_role('10000000-0000-0000-0000-000000000001')='employee' and workforce_private.membership_role('10000000-0000-0000-0000-000000000002')='manager', 'roles are company-specific');

select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000004',false);
select pg_temp.check_true((select count(*)=0 from public.tenants), 'unconfirmed identity has no tenant access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000005',false);
select pg_temp.check_true((select count(*)=0 from public.tenants), 'anonymous Auth identity has no tenant access');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
select pg_temp.check_true((select count(*)=0 from public.tenants), 'non-member has no tenant access');
select set_config('request.jwt.claim.sub','',false);
select pg_temp.check_true((select count(*)=0 from public.tenants), 'missing identity has no tenant access');

reset role;
update auth.users set raw_user_meta_data='{"role":"owner","tenant_id":"10000000-0000-0000-0000-000000000001"}' where id='00000000-0000-0000-0000-000000000006';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000006',false);
select pg_temp.check_true((select count(*)=0 from public.tenants), 'user metadata cannot grant membership or role');

reset role;
update public.tenant_memberships set status='suspended' where tenant_id='10000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000002';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000002',false);
select pg_temp.check_true((select count(*)=1 from public.tenants), 'suspension removes company A without changing user token');
select pg_temp.check_true((select count(*)=0 from public.tenant_memberships where tenant_id='10000000-0000-0000-0000-000000000001'), 'suspended membership cannot read directory');

reset role;
update public.tenants set status='suspended' where id='10000000-0000-0000-0000-000000000002';
set role authenticated;
select pg_temp.check_true((select count(*)=0 from public.tenants), 'company suspension removes access');
reset role;

do $$
begin
 begin
  insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values ('10000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000001','Duplicate','employee');
  raise exception 'Unexpected duplicate membership';
 exception when unique_violation then raise notice 'PASS: duplicate membership rejected'; end;
 begin
  insert into public.tenants(name,time_zone) values ('Invalid zone','Not/A_Zone');
  raise exception 'Unexpected invalid zone';
 exception when invalid_parameter_value then raise notice 'PASS: invalid time zone rejected'; end;
 begin
  update public.tenant_memberships set role='global_admin';
  raise exception 'Unexpected role';
 exception when check_violation then raise notice 'PASS: unsupported role rejected'; end;
 begin
  insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values ('10000000-0000-0000-0000-000000000099','00000000-0000-0000-0000-000000000001','Foreign','employee');
  raise exception 'Unexpected missing company';
 exception when foreign_key_violation then raise notice 'PASS: membership requires existing company'; end;
end;
$$;

set role service_role;
select pg_temp.check_true((select count(*)=2 from public.tenants), 'service role is privileged and must remain server-only');
reset role;
