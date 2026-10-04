-- Populated prior-module rows, plus independent organizational profiles.
\ir updates-export-fixture.sql
insert into public.agent_fields(tenant_id,key,label)values('88000000-0000-4000-8000-000000000001','branch','Branch');
insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,title,team,custom_fields,created_by)
select ('77000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,'88000000-0000-4000-8000-000000000001',case when n<=13 then ('00000000-0000-4000-8001-'||lpad((n+1)::text,12,'0'))::uuid else null end,'Synthetic',lpad(n::text,4,'0'),'+1555'||lpad(n::text,7,'0'),'Cook','North','{"branch":"New York"}','00000000-0000-4000-8000-000000000901'from generate_series(1,1005)n;
update public.tenant_memberships set status='suspended'where user_id='00000000-0000-4000-8001-000000000012';
update auth.users set email_confirmed_at=null where id='00000000-0000-4000-8001-000000000013';
update auth.users set is_anonymous=true where id='00000000-0000-4000-8001-000000000014';
insert into public.agents(tenant_id,first_name,last_name,phone,title,team,status,created_by)values('88000000-0000-4000-8000-000000000001','Archived','Record','+19990000001','Cook','North','archived','00000000-0000-4000-8000-000000000901');
