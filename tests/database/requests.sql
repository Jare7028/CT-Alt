\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$begin if ok is distinct from true then raise exception 'FAIL: %',label;end if;raise notice 'PASS: %',label;end;$$;
create function pg_temp.expect_error(command text,expected text,label text) returns void language plpgsql as $$begin begin execute command;exception when others then if sqlstate<>expected then raise exception 'FAIL: % expected % got % (%)',label,expected,sqlstate,sqlerrm;end if;raise notice 'PASS: %',label;return;end;raise exception 'FAIL: % unexpectedly succeeded',label;end;$$;
create function pg_temp.create_request(n text,g uuid default null,a uuid default null) returns jsonb language sql as $$select jsonb_build_object('action','create','title',n,'description','Literal %_ details','priority','normal','dueDate','2026-10-04','assigneeAgentId',g,'assigneeActorId',a)$$;
create function pg_temp.save(c jsonb,op uuid default gen_random_uuid()) returns jsonb language sql as $$select public.save_request('61000000-0000-0000-0000-000000000001',op,c::text)$$;
do $$declare t text;p text;begin foreach t in array array['work_requests','work_request_audit'] loop perform pg_temp.check_true((select relrowsecurity from pg_class where oid=('public.'||t)::regclass),'RLS on '||t);foreach p in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE'] loop perform pg_temp.check_true(not has_table_privilege('anon','public.'||t,p),'anon denied '||p||' '||t);if p<>'SELECT' then perform pg_temp.check_true(not has_table_privilege('authenticated','public.'||t,p),'browser denied '||p||' '||t);end if;end loop;end loop;end;$$;
select pg_temp.check_true(not has_table_privilege('authenticated','workforce_private.request_operations','SELECT'),'receipts private');
select pg_temp.check_true(not has_function_privilege('authenticated','workforce_private.requests_locks(uuid,uuid)','EXECUTE'),'raw lock helper private');
select pg_temp.check_true(not has_function_privilege('anon','public.save_request(uuid,uuid,text)','EXECUTE'),'anon mutations denied');
select pg_temp.check_true((select not prosecdef and provolatile='s' and proconfig @> array['search_path=""'] from pg_proc where oid='public.read_requests(uuid,text,text,integer,text,jsonb,uuid)'::regprocedure),'board stable invoker empty path');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.save(pg_temp.create_request('Assigned',(select id from public.agents where phone='+447700900404'),'00000000-0000-0000-0000-000000000404'),'72000000-0000-0000-0000-000000000001');
select pg_temp.save(pg_temp.create_request('Assigned',(select id from public.agents where phone='+447700900404'),'00000000-0000-0000-0000-000000000404'),'72000000-0000-0000-0000-000000000001');
select pg_temp.check_true((select count(*)=1 from public.work_requests),'create exact retry one request');
select pg_temp.check_true((select count(*)=1 from public.work_request_audit),'create exact retry one audit');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Changed'),'72000000-0000-0000-0000-000000000001')$q$,'40001','changed operation payload rejected');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Bad')||'{"surprise":true}')$q$,'22023','unknown mutation properties rejected');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Bad')||'{"dueDate":"2026-02-30"}')$q$,'22008','invalid calendar date rejected');
select pg_temp.expect_error($q$select public.save_request('61000000-0000-0000-0000-000000000001',gen_random_uuid(),'{"action":"create","action":"create"}')$q$,'22023','raw duplicate keys rejected');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request(repeat('😀',81)))$q$,'22023','title counts UTF16 not codepoints');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Bad',gen_random_uuid(),gen_random_uuid()))$q$,'42501','invalid linked assignment denied');
select id::text assigned_id from public.work_requests where title='Assigned' \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',false);
select pg_temp.check_true((select count(*)=0 from public.work_requests),'manager no implicit team read');
select pg_temp.save(pg_temp.create_request('Manager own'));
select pg_temp.check_true((select count(*)=1 from public.work_requests),'manager own request readable');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Manager assigns',(select id from public.agents limit 1),'00000000-0000-0000-0000-000000000404'))$q$,'42501','nonadmin cannot assign');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.check_true((select count(*)=1 from public.work_requests),'linked assignee sees assigned only');
select pg_temp.expect_error(format($q$select pg_temp.save(jsonb_build_object('action','edit','requestId',%L,'revision',1)||(pg_temp.create_request('Alter')-'action'))$q$,:'assigned_id'),'42501','assignee cannot edit request content');
select pg_temp.save(jsonb_build_object('action','move','requestId',:'assigned_id','revision',1,'status','in_progress'),'72000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select revision=2 and status='in_progress' from public.work_requests where id=:'assigned_id'),'assignee keyboard move persisted revision');
select pg_temp.save(jsonb_build_object('action','move','requestId',:'assigned_id','revision',1,'status','in_progress'),'72000000-0000-0000-0000-000000000002');
select pg_temp.check_true((select count(*)=2 from public.work_request_audit),'move retry no duplicate audit');
select pg_temp.expect_error(format($q$select pg_temp.save(jsonb_build_object('action','move','requestId',%L,'revision',1,'status','done'))$q$,:'assigned_id'),'40001','stale revision conflicts');
select pg_temp.expect_error(format($q$select pg_temp.save(jsonb_build_object('action','move','requestId',%L,'revision',2,'status','in_progress'))$q$,:'assigned_id'),'22023','same status invalid transition');
select pg_temp.expect_error($q$select public.read_requests('61000000-0000-0000-0000-000000000001','assignees')$q$,'42501','personal cannot list linked team');
select pg_temp.expect_error($q$select public.read_requests('61000000-0000-0000-0000-000000000002')$q$,'42501','foreign company board denied');
reset role;update public.agents set user_id=null where phone='+447700900405';update public.agents set user_id='00000000-0000-0000-0000-000000000405' where phone='+447700900404';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.check_true((select count(*)=0 from public.work_requests),'relinked original assignee loses read');
select pg_temp.expect_error(format($q$select pg_temp.save(jsonb_build_object('action','move','requestId',%L,'revision',1,'status','in_progress'),'72000000-0000-0000-0000-000000000002')$q$,:'assigned_id'),'42501','replay rechecks relink before receipt');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',false);
select pg_temp.check_true((select count(*)=0 from public.work_requests),'replacement linked actor gains no old assignment');
select pg_temp.save(pg_temp.create_request('Own new'));
select id::text own_id from public.work_requests where title='Own new' \gset
select pg_temp.save((pg_temp.create_request('Own edited')-'action')||jsonb_build_object('action','edit','requestId',:'own_id','revision',1));
select pg_temp.check_true((select title='Own edited' and revision=2 from public.work_requests where id=:'own_id'),'requester edits own unassigned New');
select public.reconcile_request_operation('61000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000099','create');
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Late'),'72000000-0000-0000-0000-000000000099')$q$,'40001','absence tombstone prevents late save');
reset role;update public.agents set user_id='00000000-0000-0000-0000-000000000404' where phone='+447700900404';update public.agents set user_id='00000000-0000-0000-0000-000000000405' where phone='+447700900405';
insert into public.work_requests(tenant_id,title,description,priority,status,revision,requester_id,requester_name,created_at)select '61000000-0000-0000-0000-000000000001','Bulk '||n,'Literal %_','normal','new',1,'00000000-0000-0000-0000-000000000401','Synthetic owner','2026-10-04T12:00:00Z'::timestamptz + n*interval '1 microsecond' from generate_series(1,1005)n;
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.check_true((public.read_requests('61000000-0000-0000-0000-000000000001','board','Bulk',20)->'counts'->>'new')::integer=1005,'exact count exceeds1000');
select pg_temp.check_true(jsonb_array_length(public.read_requests('61000000-0000-0000-0000-000000000001','board','Bulk',20)->'columns'->'new'->'requests')=20,'each column page bounded independently');
select pg_temp.check_true((public.read_requests('61000000-0000-0000-0000-000000000001','board','%_',20)->'counts'->>'total')::integer=1008,'search percent underscore literal');
select public.read_requests('61000000-0000-0000-0000-000000000001','board','Bulk',20)->'columns'->'new'->'nextCursor' as page \gset
select pg_temp.check_true(public.read_requests('61000000-0000-0000-0000-000000000001','column','Bulk',20,'new',:'page')->'requests'->0->>'title'='Bulk 985','microsecond cursor continues exact next row');
select pg_temp.expect_error(format($q$select public.read_requests('61000000-0000-0000-0000-000000000001','column','Changed',20,'new',%L::jsonb)$q$,:'page'),'40001','cursor filter scope bound');
select pg_temp.check_true((public.read_requests('61000000-0000-0000-0000-000000000001','assignees')->>'matchedCount')::integer=5,'eligible roster exact current count');
reset role;update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000401';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.check_true((select count(*)=0 from public.work_requests),'suspended stale JWT direct RLS empty');
select pg_temp.expect_error($q$select public.read_requests('61000000-0000-0000-0000-000000000001')$q$,'42501','suspended board denied not empty success');
select pg_temp.expect_error($q$select public.reconcile_request_operation('61000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000099','create')$q$,'42501','suspended receipt recovery denied');
reset role;update public.tenant_memberships set status='active' where user_id='00000000-0000-0000-0000-000000000401';

set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000406',false);
select pg_temp.check_true(workforce_private.requests_access('61000000-0000-0000-0000-000000000001',gen_random_uuid()) is false,'foreign helper is false neverNULL');
reset role;update auth.users set email_confirmed_at=null where id='00000000-0000-0000-0000-000000000401';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Unconfirmed'))$q$,'42501','unconfirmed signed creator denied');
reset role;update auth.users set email_confirmed_at=now(),is_anonymous=true where id='00000000-0000-0000-0000-000000000401';
set role authenticated;
select pg_temp.expect_error($q$select public.read_requests('61000000-0000-0000-0000-000000000001')$q$,'42501','anonymous oldJWT board denied');
reset role;update auth.users set is_anonymous=false where id='00000000-0000-0000-0000-000000000401';
update public.tenants set status='suspended' where id='61000000-0000-0000-0000-000000000001';set role authenticated;
select pg_temp.expect_error($q$select public.reconcile_request_operation('61000000-0000-0000-0000-000000000001',gen_random_uuid(),'create')$q$,'42501','suspended company cannot close recovery');
reset role;update public.tenants set status='active' where id='61000000-0000-0000-0000-000000000001';
set role authenticated;
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request(E' \t\n'))$q$,'22023','SQL whitespace title parity');
select pg_temp.check_true((public.reconcile_request_operation('61000000-0000-0000-0000-000000000001','72000000-0000-0000-0000-000000000001','create')->>'status')='recorded','recorded recovery retains original request metadata');
reset role;

-- Current authority is required for create receipts after subsequent triage.
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',false);
select pg_temp.save(pg_temp.create_request('Requester triaged later'),'74000000-0000-0000-0000-000000000001');
select id::text replay_id from public.work_requests where title='Requester triaged later' \gset
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.save((pg_temp.create_request('Requester triaged later',(select id from public.agents where phone='+447700900404'),'00000000-0000-0000-0000-000000000404')-'action')||jsonb_build_object('action','edit','requestId',:'replay_id','revision',1));
reset role;select md5(string_agg(to_jsonb(o)::text,'|' order by operation_id)) receipt_digest from workforce_private.request_operations o \gset
select count(*) audit_count from public.work_request_audit \gset
select md5(to_jsonb(r)::text) row_digest from public.work_requests r where id=:'replay_id' \gset
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000405',false);
select pg_temp.expect_error($q$select pg_temp.save(pg_temp.create_request('Requester triaged later'),'74000000-0000-0000-0000-000000000001')$q$,'42501','create receipt replay denies requester after administrator assignment');
select pg_temp.expect_error($q$select public.reconcile_request_operation('61000000-0000-0000-0000-000000000001','74000000-0000-0000-0000-000000000001','create')$q$,'42501','assigned create recovery and replay share current authority');
select pg_temp.check_true((select count(*)=1 from public.work_requests where id=:'replay_id'),'requester retains original requested read only');
reset role;
select pg_temp.check_true((select md5(string_agg(to_jsonb(o)::text,'|' order by operation_id))=:'receipt_digest' from workforce_private.request_operations o),'denied assigned-create replay changes no receipts');
select pg_temp.check_true((select count(*)=:'audit_count'::integer from public.work_request_audit),'denied assigned-create replay changes no audits');
select pg_temp.check_true((select md5(to_jsonb(r)::text)=:'row_digest' from public.work_requests r where id=:'replay_id'),'denied assigned-create replay changes no request');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select pg_temp.create_request('Admin downgrade replay',(select id from public.agents where phone='+447700900404'),'00000000-0000-0000-0000-000000000404')::text downgrade_payload \gset
select pg_temp.save(:'downgrade_payload'::jsonb,'74000000-0000-0000-0000-000000000002');
reset role;update public.tenant_memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000402';
select md5(string_agg(to_jsonb(o)::text,'|' order by operation_id)) receipt_digest from workforce_private.request_operations o \gset
select count(*) audit_count from public.work_request_audit \gset
set role authenticated;
select pg_temp.expect_error(format($q$select pg_temp.save(%L::jsonb,'74000000-0000-0000-0000-000000000002')$q$,:'downgrade_payload'),'42501','downgraded administrator cannot replay assigned creation');
reset role;
select pg_temp.check_true((select md5(string_agg(to_jsonb(o)::text,'|' order by operation_id))=:'receipt_digest' from workforce_private.request_operations o),'downgraded create replay changes no receipts');
select pg_temp.check_true((select count(*)=:'audit_count'::integer from public.work_request_audit),'downgraded create replay changes no audits');
update public.tenant_memberships set role='admin' where user_id='00000000-0000-0000-0000-000000000402';

-- A non-anchor name can move across an existing roster cursor even when the
-- naive concatenation of first and last names is unchanged.
update public.agents set first_name='A',last_name='A' where phone='+447700900401';
update public.agents set first_name='A',last_name='BC' where phone='+447700900402';
update public.agents set first_name='AA',last_name='A' where phone='+447700900403';
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select public.read_requests('61000000-0000-0000-0000-000000000001','assignees','',3)->'nextCursor' as roster_page \gset
select public.read_requests('61000000-0000-0000-0000-000000000001','assignees','',3)->>'scopeVersion' as roster_version \gset
select pg_temp.check_true((:'roster_page'::jsonb->>'key')='aa a','multi-page roster anchor is unchanged selected third account');
reset role;update public.agents set first_name='AB',last_name='C' where phone='+447700900402';
set role authenticated;
select pg_temp.check_true(public.read_requests('61000000-0000-0000-0000-000000000001','assignees','',3)->>'scopeVersion'<>:'roster_version','framed roster tuple detects A/BC to AB/C nonanchor rename');
select pg_temp.expect_error(format($q$select public.read_requests('61000000-0000-0000-0000-000000000001','assignees','',3,null,%L::jsonb)$q$,:'roster_page'),'40001','nonanchor crossing cursor boundary cannot repeat or omit old page');
reset role;
