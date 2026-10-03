\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end;$$;
create function pg_temp.expect_error(command text,expected text,label text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end;$$;
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(401,406)n;
insert into public.tenants(id,name,time_zone) values('61000000-0000-0000-0000-000000000001','Tasks synthetic A','Europe/London'),('61000000-0000-0000-0000-000000000002','Tasks synthetic B','UTC');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select '61000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Synthetic '||n,case n when 401 then 'owner' when 402 then 'admin' when 403 then 'manager' else 'employee' end from generate_series(401,405)n;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values('61000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000406','Foreign','owner');
insert into public.agents(tenant_id,user_id,first_name,last_name,phone,created_by) select '61000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Synthetic',n::text,'+447700900'||n,'00000000-0000-0000-0000-000000000401' from generate_series(401,405)n;
create function pg_temp.save(c jsonb,operation uuid default gen_random_uuid()) returns jsonb language sql as $$select public.save_quick_task('61000000-0000-0000-0000-000000000001',operation,c)$$;
create function pg_temp.create_task(n text,m text default 'group',p text default 'published') returns jsonb language sql as $$select jsonb_build_object('action','create','title',n,'description','Synthetic details','mode',m,'publication',p,'startDate',null,'dueDate','2026-10-01','agentIds',(select jsonb_agg(id order by phone) from public.agents where phone in ('+447700900404','+447700900405')))$$;
create function pg_temp.action(a text,n text default 'Shared',extra jsonb default '{}') returns jsonb language sql as $$select pg_temp.save(jsonb_build_object('action',a,'taskId',(select id from public.quick_tasks where title=n limit 1),'revision',(select revision from public.quick_tasks where title=n limit 1))||extra)$$;
do $$declare t text;p text;begin foreach t in array array['quick_tasks','quick_task_assignees','quick_task_audit'] loop perform pg_temp.check_true((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS on '||t);foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop perform pg_temp.check_true(not has_table_privilege('anon','public.'||t,p),'anon denied '||p||' '||t);if p<>'SELECT' then perform pg_temp.check_true(not has_table_privilege('authenticated','public.'||t,p),'browser denied '||p||' '||t);end if;end loop;end loop;end;$$;
select pg_temp.check_true(not has_table_privilege('authenticated','workforce_private.quick_task_operations','SELECT'),'operation receipts private');
select pg_temp.check_true(not has_function_privilege('anon','public.save_quick_task(uuid,uuid,jsonb)','EXECUTE'),'anonymous task mutation denied');
select pg_temp.check_true((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.read_quick_tasks(uuid,text,text,text,boolean,integer,jsonb,uuid)'::regprocedure),'stable read uses invoker RLS');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.save(pg_temp.create_task('Shared'),'71000000-0000-0000-0000-000000000001');
select pg_temp.save(pg_temp.create_task('Shared'),'71000000-0000-0000-0000-000000000001');
select pg_temp.check_true((select count(*)=1 from public.quick_tasks),'group create retry has one shared task');
select pg_temp.check_true((select count(*)=1 from public.quick_task_audit),'group retry creates exactly one audit');
select pg_temp.check_true((select count(*)=2 from public.quick_task_assignees),'group shares two assignees');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_task('Different'),'71000000-0000-0000-0000-000000000001')$q$,'40001','UUID payload mismatch conflicts');
select pg_temp.save(pg_temp.create_task('Individual','separate'));
select pg_temp.check_true((select count(*)=2 from public.quick_tasks where title='Individual'),'separate mode atomically creates independent task rows');
select pg_temp.check_true((select count(*)=2 from public.quick_task_assignees where task_id in (select id from public.quick_tasks where title='Individual')),'separate rows each have one assignee');
select pg_temp.save(pg_temp.create_task('Draft','group','draft'));
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_task('Bad dates')||'{"startDate":"2026-10-03","dueDate":"2026-10-02"}')$q$,'23514','reversed deadline rejected atomically');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_task('Forged')||'{"completed_at":"2026-01-01"}')$q$,'22023','client completion timestamps rejected');
select pg_temp.expect_error($q$select public.save_quick_task('61000000-0000-0000-0000-000000000002',gen_random_uuid(),pg_temp.create_task('Foreign'))$q$,'42501','foreign tenant create denied');
select (select id::text from public.quick_tasks where title='Draft') as draft_id \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',false);
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_task('Manager create'))$q$,'42501','manager cannot create tasks');
select pg_temp.expect_error($q$select public.read_quick_tasks('61000000-0000-0000-0000-000000000001','all')$q$,'42501','manager cannot read All Tasks');
select pg_temp.check_true((select count(*)=0 from public.quick_tasks),'unassigned manager cannot read task content');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.check_true((select count(*)=2 from public.quick_tasks),'employee sees only own published group and individual task');
select pg_temp.expect_error(format($q$select public.read_quick_tasks('61000000-0000-0000-0000-000000000001',detail_id=>%L)$q$,:'draft_id'),'42501','known draft UUID remains private');
select pg_temp.action('complete');
select pg_temp.check_true((select status='done' and completed_by=auth.uid() and completed_at between statement_timestamp()-interval '5 seconds' and statement_timestamp() from public.quick_tasks where title='Shared'),'assignee completes shared group with server actor/time');
select pg_temp.action('complete','Individual');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',false);
select pg_temp.check_true((select status='done' from public.quick_tasks where title='Shared'),'second assignee sees shared completion');
select pg_temp.check_true((select status='open' from public.quick_tasks where title='Individual'),'second separate assignee remains independently open');
select pg_temp.expect_error($q$select pg_temp.action('reopen')$q$,'42501','employee cannot reopen task');
select pg_temp.expect_error($q$select pg_temp.action('complete','Shared','{"revision":1}')$q$,'40001','stale task completion rejected');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.action('reopen');select pg_temp.action('archive');
select pg_temp.check_true((select archived and status='open' from public.quick_tasks where title='Shared'),'archive preserves reopened state');
select pg_temp.action('restore');select pg_temp.action('publish','Draft');
select pg_temp.check_true((select publication='published' from public.quick_tasks where title='Draft'),'draft explicitly published');
-- Current assignment is checked before acknowledging a saved completion.
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select jsonb_build_object('action','complete','taskId',id,'revision',revision)::text as replay_payload from public.quick_tasks where title='Shared' \gset
select pg_temp.save(:'replay_payload'::jsonb,'71000000-0000-0000-0000-000000000004');
reset role;delete from public.quick_task_assignees where task_id=(select id from public.quick_tasks where title='Shared') and agent_id=(select id from public.agents where phone='+447700900404');set role authenticated;
select pg_temp.expect_error(format($q$select pg_temp.save(%L::jsonb,'71000000-0000-0000-0000-000000000004')$q$,:'replay_payload'),'42501','assignment removal denies acknowledged completion replay');
reset role;
-- Large roster is explicitly paginated, including duplicate names and literal search.
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(500,604)n;
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select '61000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Roster '||n,'employee' from generate_series(500,604)n;
insert into public.agents(tenant_id,user_id,first_name,last_name,phone,created_by) select '61000000-0000-0000-0000-000000000001',('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,'Roster','Same name','+447700901'||n,'00000000-0000-0000-0000-000000000401' from generate_series(500,604)n;
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.check_true(jsonb_array_length(public.read_quick_tasks('61000000-0000-0000-0000-000000000001')->'assignableAgents')=100 and (public.read_quick_tasks('61000000-0000-0000-0000-000000000001')->>'assignableAgentsHasMore')::boolean,'initial roster cap has explicit more flag');
select public.read_quick_tasks('61000000-0000-0000-0000-000000000001') as initial_roster \gset
select pg_temp.check_true(jsonb_array_length(public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','',100,:'initial_roster'::jsonb->'assignableAgentsCursor')->'agents')=10,'initial roster cursor continues after first100');
select pg_temp.check_true(not exists(select 1 from jsonb_array_elements(:'initial_roster'::jsonb->'assignableAgents') a join jsonb_array_elements(public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','',100,:'initial_roster'::jsonb->'assignableAgentsCursor')->'agents') b on a->>'id'=b->>'id'),'initial roster cursor does not repeat first page');
select public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','Roster',100) as roster_page \gset
select pg_temp.check_true(jsonb_array_length(:'roster_page'::jsonb->'agents')=100 and jsonb_array_length(public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','Roster',100,:'roster_page'::jsonb->'nextCursor')->'agents')=5,'searched roster returns all105 through bounded pages');
select pg_temp.check_true(not exists(select 1 from jsonb_array_elements(:'roster_page'::jsonb->'agents') a join jsonb_array_elements(public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','Roster',100,:'roster_page'::jsonb->'nextCursor')->'agents') b on a->>'id'=b->>'id'),'duplicate names keyset does not duplicate boundary');
select pg_temp.check_true(jsonb_array_length(public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','%_',10)->'agents')=0,'roster search treats wildcard characters literally');
select pg_temp.expect_error(format($q$select public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','Changed',100,%L::jsonb)$q$,:'roster_page'::jsonb->'nextCursor'),'22023','roster cursor bound to search');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select pg_temp.expect_error(format($q$select public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001','Roster',100,%L::jsonb)$q$,:'roster_page'::jsonb->'nextCursor'),'22023','roster cursor bound to current actor');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.expect_error($q$select public.read_quick_task_assignees('61000000-0000-0000-0000-000000000001')$q$,'42501','employee roster access denied');
reset role;
-- Admin creation replay is authorized by the current role, not the old receipt.
update public.tenant_memberships set role='employee' where tenant_id='61000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000401';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_task('Shared'),'71000000-0000-0000-0000-000000000001')$q$,'42501','revoked admin cannot replay creation receipt');
reset role;update public.tenant_memberships set role='owner' where tenant_id='61000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000401';
-- Counts exceed the directory cap; task pages still remain bounded.
insert into public.quick_tasks(tenant_id,title,description,mode,publication,created_by,batch_id) select '61000000-0000-0000-0000-000000000001','Counters '||n,'','group','published','00000000-0000-0000-0000-000000000401',gen_random_uuid() from generate_series(1,1005)n;
insert into public.quick_task_assignees select tenant_id,id,(select id from public.agents where phone='+447700900401'),'Synthetic 401' from public.quick_tasks where title like 'Counters %';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.check_true((public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Counters',page_limit=>1)->'counts'->>'total')::integer=1005,'exact counts exceed 1000 without page truncation');
select pg_temp.check_true(jsonb_array_length(public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Counters',page_limit=>1)->'tasks')=1,'task page remains bounded');
select pg_temp.check_true((public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Synthetic details')->'counts'->>'total')::integer>0,'description search returns matching tasks');
select pg_temp.check_true((public.read_quick_tasks('61000000-0000-0000-0000-000000000001',state_filter=>'open')->'counts'->>'done')::integer>0,'status counters preserve other status count');
select pg_temp.check_true(public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Counters',page_limit=>1)->'tasks'->0->>'id'<>public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Counters',page_limit=>1,after_task=>public.read_quick_tasks('61000000-0000-0000-0000-000000000001',search_text=>'Counters',page_limit=>1)->'nextCursor')->'tasks'->0->>'id','keyset next page does not duplicate boundary');
select pg_temp.check_true(workforce_private.quick_task_overdue('2026-10-31','America/Havana','2026-11-01T04:30:00Z') and not workforce_private.quick_task_overdue('2026-11-01','America/Havana','2026-11-01T04:30:00Z'),'Havana first midnight hour uses the correct inclusive deadline date');
select pg_temp.check_true(not workforce_private.quick_task_overdue('2026-10-25','Europe/London','2026-10-25T23:59:59Z') and workforce_private.quick_task_overdue('2026-10-25','Europe/London','2026-10-26T00:00:00Z'),'25-hour due date lasts through last company instant');
select pg_temp.check_true(not workforce_private.quick_task_overdue('2026-03-08','America/New_York','2026-03-09T03:59:59Z') and workforce_private.quick_task_overdue('2026-03-08','America/New_York','2026-03-09T04:00:00Z'),'23-hour due date ends at correct local midnight');
select pg_temp.check_true(workforce_private.quick_task_overdue('2011-12-30','Pacific/Apia','2011-12-30T10:00:00Z'),'skipped due date becomes overdue when local date advances past it');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000406',false);
select pg_temp.check_true((select count(*)=0 from public.quick_tasks),'foreign tenant cannot read task tables');
select pg_temp.expect_error($q$select public.read_quick_tasks('61000000-0000-0000-0000-000000000001')$q$,'42501','foreign task RPC access denied');
reset role;
