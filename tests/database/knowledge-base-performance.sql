-- Fresh table statistics, realistic large Auth roster and a depth3 sibling tree.
-- No ANALYZE or foundation/policy/function edits; rollback restores legacy rows.
begin;
create function pg_temp.perf_check(ok boolean,label text)returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end$$;
insert into auth.users(id,email_confirmed_at)select('69000000-0000-4000-8002-'||lpad(i::text,12,'0'))::uuid,now()from generate_series(1,1005)i;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role)select'88000000-0000-4000-8000-000000000001',('69000000-0000-4000-8002-'||lpad(i::text,12,'0'))::uuid,'Synthetic large Auth '||i,'employee'from generate_series(1,1005)i;
insert into public.knowledge_bases(id,tenant_id,name,description,status)values('6d000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','Fresh large tree','','published');
insert into public.knowledge_audience(tenant_id,base_id,actor_id,name)values('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000901','Owner');
insert into public.knowledge_nodes(id,tenant_id,base_id,parent_id,kind,name,description,depth,rank)values('6d000000-0000-4000-8000-000000000002','88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null,'folder','Section','',1,1024),('6d000000-0000-4000-8000-000000000003','88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000002','folder','Folder','',2,1024);
insert into public.knowledge_nodes(id,tenant_id,base_id,parent_id,kind,name,description,body,depth,rank)select('69000000-0000-4000-8003-'||lpad(i::text,12,'0'))::uuid,'88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000003','text',case when i<=1001 then E'Synthetic fresh %_\\ İ tie'else'Other title'end,'','Synthetic exact body',3,1000+i from generate_series(1,1005)i;
select pg_temp.perf_check((select reltuples=-1 from pg_class where oid='public.knowledge_nodes'::regclass),'large depth3 search exercises fresh unanalysed node statistics');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare d jsonb;begin
 d:=public.read_knowledge_base('88000000-0000-4000-8000-000000000001','search','manage','6d000000-0000-4000-8000-000000000001',null,null,'all',E'%_\\ İ',100,null);
 perform pg_temp.perf_check(d->>'matchedCount'='1001'and jsonb_array_length(d->'results')=100,'one fresh-stat signed RPC returns exact1001matches and bounded100page');
 perform pg_temp.perf_check(not exists(select 1 from jsonb_array_elements(d->'results')r where r#>>'{path,0,id}'<>'6d000000-0000-4000-8000-000000000002'or r#>>'{path,1,id}'<>'6d000000-0000-4000-8000-000000000003'or jsonb_array_length(r->'path')<>2),'every depth3 search result retains exact root-first ancestor identity');
end$$;
reset role;
-- Current-transaction stats avoid flush timing and machine-speed assertions.
select pg_temp.perf_check((select calls between 1 and 15000 from pg_stat_xact_user_functions where schemaname='workforce_private'and funcname='membership_role'),'fresh large Auth search uses bounded role checks rather than unrelated node full scans');
select pg_temp.perf_check((select prosecdef=false and provolatile='s'and proconfig=array['search_path=""']from pg_proc where oid='workforce_private.knowledge_path(uuid,uuid,uuid)'::regprocedure),'path lookup preserves STABLE invoker and empty search path');
set role authenticated;select set_config('request.jwt.claim.sub','69000000-0000-4000-8002-000000000001',false);
select pg_temp.perf_check(workforce_private.knowledge_path('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000003')='[]'::jsonb,'unassigned current employee ancestor lookups remain protected by RLS');
reset role;
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
select pg_temp.perf_check(workforce_private.knowledge_path('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null)='[]'::jsonb and workforce_private.knowledge_path('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',gen_random_uuid())='[]'::jsonb,'root and missing-node path semantics stay empty');
reset role;
-- Assigned-reader resource and fresh-access reads over the same fresh large tree.
insert into public.knowledge_audience(tenant_id,base_id,actor_id,name)values('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','69000000-0000-4000-8002-000000000001','Assigned employee');
create temp table reader_role_start as select calls from pg_stat_xact_user_functions where schemaname='workforce_private'and funcname='membership_role';
set role authenticated;select set_config('request.jwt.claim.sub','69000000-0000-4000-8002-000000000001',false);
do $$declare d jsonb;a jsonb;begin
 d:=public.read_knowledge_base('88000000-0000-4000-8000-000000000001','node','library','6d000000-0000-4000-8000-000000000001','69000000-0000-4000-8003-000000000001');
 a:=public.read_knowledge_base_access('88000000-0000-4000-8000-000000000001','library','6d000000-0000-4000-8000-000000000001','69000000-0000-4000-8003-000000000001');
 perform pg_temp.perf_check(d->>'actorId'='69000000-0000-4000-8002-000000000001'and d->>'body'='Synthetic exact body'and jsonb_array_length(d->'path')=2 and a->>'actorId'=d->>'actorId','large assigned reader node and fresh access retain exact actor body and path');
 perform pg_temp.perf_check(workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null)and not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',gen_random_uuid()),'authorized null path and missing ancestor retain fail-closed semantics');
end$$;
reset role;
select pg_temp.perf_check((select f.calls-s.calls between 1 and 6500 from pg_stat_xact_user_functions f cross join reader_role_start s where f.schemaname='workforce_private'and f.funcname='membership_role'),'fresh large assigned reader plus access has bounded current-role calls');
select pg_temp.perf_check((select prosecdef and provolatile='s'and proconfig=array['search_path=""']from pg_proc where oid='workforce_private.knowledge_path_active(uuid,uuid,uuid)'::regprocedure),'active-path boolean retains STABLE definer and empty search path');
update public.knowledge_nodes set status='archived'where id='6d000000-0000-4000-8000-000000000002';
set role authenticated;
select pg_temp.perf_check(not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','69000000-0000-4000-8003-000000000001'),'archived ancestor denies assigned descendant');
reset role;
update public.knowledge_nodes set status='active'where id='6d000000-0000-4000-8000-000000000002';
update public.tenant_memberships set status='suspended'where tenant_id='88000000-0000-4000-8000-000000000001'and user_id='69000000-0000-4000-8002-000000000001';
set role authenticated;
select pg_temp.perf_check(not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null),'current suspended reader denies even null path');
reset role;
update public.tenant_memberships set status='active'where tenant_id='88000000-0000-4000-8000-000000000001'and user_id='69000000-0000-4000-8002-000000000001';
update auth.users set email_confirmed_at=null where id='69000000-0000-4000-8002-000000000001';
set role authenticated;
select pg_temp.perf_check(not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null),'current unconfirmed reader denies even null path');
reset role;
update auth.users set email_confirmed_at=now()where id='69000000-0000-4000-8002-000000000001';
delete from public.knowledge_audience where base_id='6d000000-0000-4000-8000-000000000001'and actor_id='69000000-0000-4000-8002-000000000001';
set role authenticated;
select pg_temp.perf_check(not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',null),'current audience removal denies even null path');
reset role;
insert into public.knowledge_nodes(id,tenant_id,base_id,parent_id,kind,name,description,depth,rank)select('6e000000-0000-4000-8000-'||lpad(i::text,12,'0'))::uuid,'88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001',case when i=1 then null else('6e000000-0000-4000-8000-'||lpad((i-1)::text,12,'0'))::uuid end,'folder','Depth '||i,'',least(i,16),2000+i from generate_series(1,17)i;
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
select pg_temp.perf_check(workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6e000000-0000-4000-8000-000000000016')and not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6e000000-0000-4000-8000-000000000017'),'active ancestor gate accepts depth16 and rejects actual depth17');
reset role;
update public.knowledge_nodes set parent_id='6d000000-0000-4000-8000-000000000003'where id='6d000000-0000-4000-8000-000000000002';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
select pg_temp.perf_check(not workforce_private.knowledge_path_active('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000003'),'cyclic active ancestor gate terminates false');
do $$begin begin perform workforce_private.knowledge_path('88000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000001','6d000000-0000-4000-8000-000000000003');exception when sqlstate '22023'then raise notice 'PASS: invalid cyclic fixture path terminates fail-closed';return;end;raise exception 'Cyclic path unexpectedly accepted';end$$;
rollback;
