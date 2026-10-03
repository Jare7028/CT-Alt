\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end;$$;
create function pg_temp.denied(command text,expected text,label text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end;$$;
insert into auth.users(id,email_confirmed_at,is_anonymous) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,case when n=707 then null else now() end,n=708 from generate_series(701,708)n;
insert into public.tenants(id,name) values('71000000-0000-0000-0000-000000000001','Search synthetic A'),('71000000-0000-0000-0000-000000000002','Search synthetic B');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select case when n=705 then '71000000-0000-0000-0000-000000000002'::uuid else '71000000-0000-0000-0000-000000000001'::uuid end,('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Search actor '||n,case n when 701 then 'owner' when 703 then 'admin' when 704 then 'manager' when 705 then 'owner' when 706 then 'owner' else 'employee' end from generate_series(701,708)n;
insert into public.chat_conversations(id,tenant_id,kind,name,management_only) values
 ('72000000-0000-0000-0000-000000000001','71000000-0000-0000-0000-000000000001','group','Joined conversation',false),
 ('72000000-0000-0000-0000-000000000002','71000000-0000-0000-0000-000000000001','group','Other joined conversation',false),
 ('72000000-0000-0000-0000-000000000003','71000000-0000-0000-0000-000000000001','group','Private other owner',false),
 ('72000000-0000-0000-0000-000000000004','71000000-0000-0000-0000-000000000001','group','Management',true);
insert into public.chat_members(tenant_id,conversation_id,user_id) select '71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid from unnest(array[701,702,704,707,708])n;
insert into public.chat_members(tenant_id,conversation_id,user_id) values
 ('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000701'),
 ('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000706'),
 ('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000704');
insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body,created_at) select '71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',n,'00000000-0000-0000-0000-000000000701','Stored sender',gen_random_uuid(),'Inspection record '||n,'2026-10-03T12:00:00.123456Z' from generate_series(1,1505)n;
insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body,created_at) select '71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',n,'00000000-0000-0000-0000-000000000701','Stored sender',gen_random_uuid(),'precision match','2026-10-03T12:00:00.123456Z' from generate_series(9007199254740993::bigint,9007199254740995::bigint)n;
insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body) values
 ('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',2000,'00000000-0000-0000-0000-000000000701','Stored sender',gen_random_uuid(),$body$literal %_ O'Reilly <script>alert(1)</script>$body$),
 ('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000003',1,'00000000-0000-0000-0000-000000000706','Private sender',gen_random_uuid(),'Inspection private secret');
insert into public.chat_reads values('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000701',0);
insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body) values('71000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001',2001,'00000000-0000-0000-0000-000000000701','Stored sender',gen_random_uuid(),repeat('😀',4000));
create function pg_temp.search(q text,lim integer default 50,cursor jsonb default null,c uuid default '72000000-0000-0000-0000-000000000001') returns jsonb language sql as $$select public.search_chat_messages('71000000-0000-0000-0000-000000000001',c,q,lim,cursor)$$;
select pg_temp.check_true((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.search_chat_messages(uuid,uuid,text,integer,jsonb)'::regprocedure),'search is stable invoker with empty search path');
select pg_temp.check_true(not has_function_privilege('anon','public.search_chat_messages(uuid,uuid,text,integer,jsonb)','EXECUTE'),'anonymous search RPC denied');
select pg_temp.check_true(has_function_privilege('authenticated','public.search_chat_messages(uuid,uuid,text,integer,jsonb)','EXECUTE'),'signed search RPC enabled');
select pg_temp.check_true(not has_function_privilege('service_role','public.search_chat_messages(uuid,uuid,text,integer,jsonb)','EXECUTE'),'service-role default search execution removed additively');
select pg_temp.check_true(not has_table_privilege('authenticated','public.chat_reads','UPDATE'),'search does not grant read-marking writes');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',false);
select pg_temp.check_true((pg_temp.search('InSpEcTiOn')->>'total')::integer=1505,'exact case-insensitive search count exceeds1000 and excludes other conversations');
select pg_temp.check_true(jsonb_array_length(pg_temp.search('inspection',100)->'messages')=100,'message page bounded at requested100');
select pg_temp.check_true((pg_temp.search('no matching synthetic token')->>'total')::integer=0 and jsonb_array_length(pg_temp.search('no matching synthetic token')->'messages')=0,'valid no-match returns exact zero');
select pg_temp.check_true((pg_temp.search('%_')->>'total')::integer=1 and (pg_temp.search('%_')->'messages'->0->>'body') like 'literal %','wildcards searched literally');
select pg_temp.check_true((pg_temp.search('O''Reilly')->>'total')::integer=1 and (pg_temp.search($query$') OR true --$query$)->>'total')::integer=0,'quotes and SQL-shaped queries remain literal');
select pg_temp.check_true(pg_temp.search('<script>')->'messages'->0->>'sender_name'='Stored sender' and not (pg_temp.search('<script>')->'messages'->0 ? 'client_id'),'safe stored sender/body fields without private mutation token');
select pg_temp.check_true(length(pg_temp.search('😀')->'messages'->0->>'body')=4000,'PostgreSQL Unicode character boundary preserved');
select pg_temp.search('precision',2) as precision_page \gset
select pg_temp.check_true(:'precision_page'::jsonb->'messages'->0->>'sequence'='9007199254740995' and :'precision_page'::jsonb->'messages'->1->>'sequence'='9007199254740994' and jsonb_typeof(:'precision_page'::jsonb->'messages'->0->'sequence')='string','bigint sequences remain exact decimal strings');
select pg_temp.check_true(pg_temp.search('precision',2,:'precision_page'::jsonb->'nextCursor')->'messages'->0->>'sequence'='9007199254740993','precise keyset does not round or duplicate boundary');
select pg_temp.check_true(pg_temp.search('precision',2,:'precision_page'::jsonb->'nextCursor')->'messages'->0->>'created_at'='2026-10-03T12:00:00.123456+00:00','timestamp microseconds preserved despite equal timestamp ordering');
select pg_temp.check_true((select sequence=0 from public.chat_reads where user_id='00000000-0000-0000-0000-000000000701'),'search does not mark history read');
select pg_temp.denied($q$select pg_temp.search('inspection',101)$q$,'22023','oversized page denied in SQL');
select pg_temp.denied($q$select pg_temp.search('',1)$q$,'22023','blank query denied in SQL');
select pg_temp.denied($q$select pg_temp.search(repeat('x',101))$q$,'22023','oversized query denied in SQL');
select pg_temp.denied(format($q$select pg_temp.search('changed',2,%L::jsonb)$q$,:'precision_page'::jsonb->'nextCursor'),'22023','cursor bound to exact query');
select pg_temp.denied(format($q$select pg_temp.search('precision',2,%L::jsonb,'72000000-0000-0000-0000-000000000002')$q$,:'precision_page'::jsonb->'nextCursor'),'22023','cursor bound to conversation');
select pg_temp.denied(format($q$select pg_temp.search('precision',2,%L::jsonb)$q$,(:'precision_page'::jsonb->'nextCursor')||'{"sequence":"1) OR true"}'),'22023','cursor sequence grammar rejects injection');
select pg_temp.denied(format($q$select pg_temp.search('precision',2,%L::jsonb)$q$,(:'precision_page'::jsonb->'nextCursor')||'{"sequence":9007199254740994}'),'22023','direct RPC cursor requires decimal string sequence');
select pg_temp.denied($q$select pg_temp.search('Inspection',50,null,'72000000-0000-0000-0000-000000000003')$q$,'42501','owner cannot search another owner private conversation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000703',false);
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','same-company outsider admin denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000704',false);
select pg_temp.denied(format($q$select pg_temp.search('precision',2,%L::jsonb)$q$,:'precision_page'::jsonb->'nextCursor'),'22023','new current actor cannot reuse old actor cursor');
select pg_temp.check_true((pg_temp.search('inspection')->>'total')::integer=1505,'joined manager may search without admin role');
select pg_temp.check_true((pg_temp.search('inspection',50,null,'72000000-0000-0000-0000-000000000004')->>'total')::integer=0,'joined manager can search management conversation');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',false);
select pg_temp.check_true((pg_temp.search('inspection')->>'total')::integer=1505,'joined employee may search');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000705',false);
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','foreign tenant actor denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000707',false);
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','unconfirmed joined actor denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000708',false);
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','anonymous joined actor denied');
reset role;update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000702';set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000702',false);
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','existing identity suspension denies next search');
reset role;update public.tenant_memberships set status='active' where user_id='00000000-0000-0000-0000-000000000702';delete from public.chat_members where user_id='00000000-0000-0000-0000-000000000702';set role authenticated;
select pg_temp.denied($q$select pg_temp.search('inspection')$q$,'42501','conversation removal denies next search');
reset role;update public.tenant_memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000704';set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000704',false);
select pg_temp.denied($q$select pg_temp.search('inspection',50,null,'72000000-0000-0000-0000-000000000004')$q$,'42501','management role demotion denies next search');
reset role;update public.tenants set status='suspended' where id='71000000-0000-0000-0000-000000000001';set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000701',false);
select pg_temp.denied(format($q$select pg_temp.search('precision',2,%L::jsonb)$q$,:'precision_page'::jsonb->'nextCursor'),'42501','company suspension checked before cursor search');
select pg_temp.check_true((select count(*)=0 from public.chat_messages),'existing message RLS still denies suspended company');
reset role;
