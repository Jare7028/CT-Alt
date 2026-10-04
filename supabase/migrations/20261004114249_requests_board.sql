-- Additive Requests board. Existing applied migrations and objects are untouched.
create table public.work_requests (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 title text not null check(workforce_private.knowledge_utf16(title) between 1 and 160 and workforce_private.knowledge_nonblank(title)),
 description text not null check(workforce_private.knowledge_utf16(description)<=5000),
 priority text not null check(priority in('low','normal','high')), due_date date check(due_date between date '0001-01-01' and date '9999-12-31'),
 status text not null check(status in('new','in_progress','done')), revision integer not null check(revision>0),
 requester_id uuid not null references auth.users(id), requester_name text not null,
 assignee_agent_id uuid, assignee_actor_id uuid references auth.users(id), assignee_name text,
 created_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id), foreign key(tenant_id,assignee_agent_id) references public.agents(tenant_id,id),
 check((assignee_agent_id is null and assignee_actor_id is null and assignee_name is null) or (assignee_agent_id is not null and assignee_actor_id is not null and assignee_name is not null))
);
create index work_requests_page on public.work_requests(tenant_id,status,created_at desc,id desc);
create index work_requests_requester on public.work_requests(tenant_id,requester_id);
create index work_requests_assignee on public.work_requests(tenant_id,assignee_actor_id);
create table public.work_request_audit (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,request_id uuid not null,
 actor_id uuid not null,action text not null check(action in('create','edit','move')),revision integer not null,status text not null,
 occurred_at timestamptz not null default clock_timestamp(),foreign key(tenant_id,request_id) references public.work_requests(tenant_id,id)
);
create table workforce_private.request_operations (
 tenant_id uuid not null references public.tenants(id), actor_id uuid not null references auth.users(id), operation_id uuid not null,
 action text not null check(action in('create','edit','move')),state text not null check(state in('recorded','closed_absent')),
 payload_hash text,result jsonb,request_id uuid, primary key(tenant_id,actor_id,operation_id),
 foreign key(tenant_id,request_id) references public.work_requests(tenant_id,id),
 check((state='recorded' and payload_hash ~ '^[0-9a-f]{64}$' and result is not null and request_id is not null) or (state='closed_absent' and payload_hash is null and result is null and request_id is null))
);
alter table public.work_requests enable row level security;
alter table public.work_request_audit enable row level security;
alter table workforce_private.request_operations enable row level security;
revoke all on public.work_requests,public.work_request_audit,workforce_private.request_operations from public,anon,authenticated,service_role;
grant select on public.work_requests,public.work_request_audit to authenticated;

create function workforce_private.requests_eligible(t uuid,g uuid,a uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) is not null and exists(
 select 1 from public.agents x join public.tenant_memberships m on m.tenant_id=x.tenant_id and m.user_id=x.user_id
 join auth.users u on u.id=m.user_id join public.tenants c on c.id=x.tenant_id
 where x.tenant_id=t and x.id=g and x.user_id=a and x.status='active' and m.status='active' and c.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true),false)
$$;
create function workforce_private.requests_access(t uuid,r uuid) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) is not null and exists(select 1 from public.work_requests x where x.tenant_id=t and x.id=r and (
 workforce_private.membership_role(t) in('owner','admin') or x.requester_id=(select auth.uid()) or
 (x.assignee_actor_id=(select auth.uid()) and workforce_private.requests_eligible(t,x.assignee_agent_id,x.assignee_actor_id)))),false)
$$;
create function workforce_private.requests_change_access(t uuid,r uuid,a text) returns boolean language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) is not null and (workforce_private.membership_role(t) in('owner','admin') or
 (a='create' and (r is null or exists(select 1 from public.work_requests x where x.tenant_id=t and x.id=r and x.requester_id=(select auth.uid()) and x.assignee_agent_id is null))) or
 exists(select 1 from public.work_requests x where x.tenant_id=t and x.id=r and ((a='edit' and x.requester_id=(select auth.uid()) and x.assignee_agent_id is null and x.status='new') or (a='move' and x.assignee_actor_id=(select auth.uid()) and workforce_private.requests_eligible(t,x.assignee_agent_id,x.assignee_actor_id))))),false)
$$;
create policy work_requests_read on public.work_requests for select to authenticated using(workforce_private.requests_access(tenant_id,id));
create policy work_request_audit_read on public.work_request_audit for select to authenticated using(workforce_private.requests_access(tenant_id,request_id));
create function workforce_private.requests_time(v timestamptz) returns text language sql immutable security invoker set search_path='' as $$select to_char(v at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')$$;
create function workforce_private.requests_card(x public.work_requests) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',x.id,'tenantId',x.tenant_id,'title',x.title,'description',x.description,'priority',x.priority,'dueDate',x.due_date::text,'status',x.status,'revision',x.revision,
 'requester',jsonb_build_object('actorId',x.requester_id,'name',x.requester_name),'assignee',case when x.assignee_agent_id is null then null else jsonb_build_object('agentId',x.assignee_agent_id,'actorId',x.assignee_actor_id,'name',x.assignee_name,'eligible',workforce_private.requests_eligible(x.tenant_id,x.assignee_agent_id,x.assignee_actor_id)) end,
 'createdAt',workforce_private.requests_time(x.created_at),'updatedAt',workforce_private.requests_time(x.updated_at),
 'canEdit',workforce_private.requests_change_access(x.tenant_id,x.id,'edit'),'canMove',workforce_private.requests_change_access(x.tenant_id,x.id,'move'),'canAssign',coalesce(workforce_private.membership_role(x.tenant_id) in('owner','admin'),false))
$$;
create function workforce_private.requests_version(t uuid,roster boolean default false) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce(case when roster then (select jsonb_agg(jsonb_build_array(x.id,x.user_id,x.first_name,x.last_name) order by x.id)::text from public.agents x where x.tenant_id=t and workforce_private.requests_eligible(t,x.id,x.user_id)) else
 (select string_agg(x.id::text||':'||x.revision::text||':'||coalesce(workforce_private.requests_eligible(t,x.assignee_agent_id,x.assignee_actor_id)::text,'false'),'|' order by x.id) from public.work_requests x where x.tenant_id=t) end,''))
$$;
create function public.read_requests_access(target_tenant uuid,read_mode text default 'board',detail_id uuid default null,action_name text default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
 declare r text:=workforce_private.membership_role(target_tenant); c public.tenants; rev integer;begin
 if r is null or read_mode is null or read_mode not in('board','column','detail','assignees') or read_mode='assignees' and r not in('owner','admin') then raise exception using errcode='42501',message='Requests unavailable';end if;
 if detail_id is not null then select revision into rev from public.work_requests where tenant_id=target_tenant and id=detail_id;if not found then raise exception using errcode='42501',message='Request unavailable';end if;end if;
 if action_name is not null and (action_name not in('create','edit','move') or workforce_private.requests_change_access(target_tenant,detail_id,action_name) is distinct from true) then raise exception using errcode='42501',message='Request operation unavailable';end if;
 select * into c from public.tenants where id=target_tenant;
 return jsonb_build_object('schemaVersion',1,'company',jsonb_build_object('id',c.id,'name',c.name,'time_zone',c.time_zone),'actorId',auth.uid(),'role',r,'scopeVersion',workforce_private.requests_version(target_tenant,read_mode='assignees'),'requestRevision',rev);
 end$$;
create function public.read_requests(target_tenant uuid,read_mode text default 'board',search_text text default '',page_limit integer default 20,state_filter text default null,after_row jsonb default null,detail_id uuid default null) returns jsonb language plpgsql stable security invoker set search_path='' as $$
 declare identity jsonb;v text;counts jsonb;res jsonb;rows jsonb;next_page jsonb;cols jsonb:='{}';s text;k text;last_id uuid;total bigint;x public.work_requests;begin
 identity:=public.read_requests_access(target_tenant,read_mode,detail_id);v:=identity->>'scopeVersion';identity:=identity-'requestRevision';
 if search_text is null or workforce_private.knowledge_utf16(search_text)>100 or page_limit is null or page_limit not between 1 and 50 or
 (read_mode='detail' and (detail_id is null or search_text<>'' or state_filter is not null or after_row is not null)) or
 (read_mode<>'detail' and detail_id is not null) or (read_mode='column' and coalesce(state_filter,'') not in('new','in_progress','done')) or
 (read_mode<>'column' and state_filter is not null) or (read_mode='board' and after_row is not null) then raise exception using errcode='22023',message='Invalid request filters';end if;
 if after_row is not null then
 if after_row-array['v','tenantId','actorId','role','mode','status','search','scopeVersion','key','id']<>'{}'::jsonb or not after_row ?& array['v','tenantId','actorId','role','mode','status','search','scopeVersion','key','id'] or jsonb_typeof(after_row->'v')<>'number' or jsonb_typeof(after_row->'key')<>'string' or jsonb_typeof(after_row->'id')<>'string' or after_row->>'key' is null or after_row->>'id' is null or jsonb_typeof(after_row)<>'object' or after_row->>'v'<>'1' or after_row->>'tenantId' is distinct from target_tenant::text or after_row->>'actorId' is distinct from auth.uid()::text or after_row->>'role' is distinct from identity->>'role' or after_row->>'mode' is distinct from read_mode or after_row->>'search' is distinct from search_text or after_row->>'scopeVersion' is distinct from v or (after_row->>'status') is distinct from state_filter then raise exception using errcode='40001',message='Request page changed';end if;
 k:=after_row->>'key';last_id:=(after_row->>'id')::uuid;
 if read_mode='column' and not exists(select 1 from public.work_requests w where w.tenant_id=target_tenant and w.id=last_id and w.status=state_filter and workforce_private.requests_time(w.created_at)=k and (search_text='' or strpos(lower(w.title||' '||w.description),lower(search_text))>0)) then raise exception using errcode='40001',message='Request page changed';end if;
 if read_mode='assignees' and not exists(select 1 from public.agents a where a.tenant_id=target_tenant and a.id=last_id and workforce_private.requests_eligible(target_tenant,a.id,a.user_id) and lower(btrim(a.first_name||' '||a.last_name))=k and (search_text='' or strpos(lower(btrim(a.first_name||' '||a.last_name)),lower(search_text))>0)) then raise exception using errcode='40001',message='Assignee page changed';end if;
 end if;
 if read_mode='detail' then select * into x from public.work_requests where tenant_id=target_tenant and id=detail_id;return identity||jsonb_build_object('mode','detail','request',workforce_private.requests_card(x),'serverTime',workforce_private.requests_time(statement_timestamp()));end if;
 if read_mode='assignees' then
 select count(*) into total from public.agents a where a.tenant_id=target_tenant and workforce_private.requests_eligible(target_tenant,a.id,a.user_id) and (search_text='' or strpos(lower(btrim(a.first_name||' '||a.last_name)),lower(search_text))>0);
 select coalesce(jsonb_agg(y.data order by y.name,y.id),'[]') into rows from(select a.id,lower(btrim(a.first_name||' '||a.last_name)) name,jsonb_build_object('agentId',a.id,'actorId',a.user_id,'name',btrim(a.first_name||' '||a.last_name)) data from public.agents a where a.tenant_id=target_tenant and workforce_private.requests_eligible(target_tenant,a.id,a.user_id) and (search_text='' or strpos(lower(btrim(a.first_name||' '||a.last_name)),lower(search_text))>0) and (after_row is null or (lower(btrim(a.first_name||' '||a.last_name)),a.id)>(k,last_id)) order by lower(btrim(a.first_name||' '||a.last_name)),a.id limit page_limit+1)y;
 next_page:=null;if jsonb_array_length(rows)>page_limit then rows:=rows-(jsonb_array_length(rows)-1);next_page:=jsonb_build_object('v',1,'tenantId',target_tenant,'actorId',auth.uid(),'role',identity->>'role','mode',read_mode,'status',null,'search',search_text,'scopeVersion',v,'id',rows->-1->>'agentId','key',lower(rows->-1->>'name'));end if;
 return identity||jsonb_build_object('mode','assignees','search',search_text,'matchedCount',total,'users',rows,'nextCursor',next_page,'serverTime',workforce_private.requests_time(statement_timestamp()));end if;
 select jsonb_build_object('new',count(*)filter(where status='new'),'in_progress',count(*)filter(where status='in_progress'),'done',count(*)filter(where status='done'),'total',count(*)) into counts from public.work_requests where tenant_id=target_tenant and(search_text='' or strpos(lower(title||' '||description),lower(search_text))>0);
 foreach s in array case when read_mode='board' then array['new','in_progress','done'] else array[state_filter] end loop
 select coalesce(jsonb_agg(y.data order by y.created_at desc,y.id desc),'[]') into rows from(select w.created_at,w.id,workforce_private.requests_card(w) data from public.work_requests w where w.tenant_id=target_tenant and w.status=s and (search_text='' or strpos(lower(w.title||' '||w.description),lower(search_text))>0) and (after_row is null or (w.created_at,w.id)<(k::timestamptz,last_id)) order by w.created_at desc,w.id desc limit page_limit+1)y;
 next_page:=null;if jsonb_array_length(rows)>page_limit then rows:=rows-(jsonb_array_length(rows)-1);next_page:=jsonb_build_object('v',1,'tenantId',target_tenant,'actorId',auth.uid(),'role',identity->>'role','mode','column','status',s,'search',search_text,'scopeVersion',v,'key',rows->-1->>'createdAt','id',rows->-1->>'id');end if;
 cols:=cols||jsonb_build_object(s,jsonb_build_object('requests',rows,'nextCursor',next_page));end loop;
 res:=identity||jsonb_build_object('mode',read_mode,'search',search_text,'counts',counts,'serverTime',workforce_private.requests_time(statement_timestamp()));
 if read_mode='board' then return res||jsonb_build_object('columns',cols,'capabilities',jsonb_build_object('canCreate',true,'canManage',identity->>'role' in('owner','admin')));end if;
 return res||jsonb_build_object('status',state_filter)||(cols->state_filter);
 end$$;
-- Both save and recovery take the same operation then company mutex. Identity rows
-- stay locked until commit: membership changes and relinking cannot pass mid-write.
create function workforce_private.requests_locks(t uuid,op uuid) returns text language plpgsql volatile security definer set search_path='' as $$
 declare actor uuid:=auth.uid();r text;begin
 if actor is null or t is null or op is null or workforce_private.membership_role(t) is null then raise exception using errcode='42501',message='Requests unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(actor::text||':'||op::text,90));
 perform pg_advisory_xact_lock(hashtextextended(t::text,91));
 perform 1 from public.tenants where id=t for share;
 perform 1 from auth.users where id=actor for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor for share;
 r:=workforce_private.membership_role(t);if r is null then raise exception using errcode='42501',message='Requests unavailable';end if;return r;
 end$$;
create function workforce_private.save_request(t uuid,op uuid,change_text text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
 declare c jsonb;a text;r text;actor uuid:=auth.uid();x public.work_requests;rec workforce_private.request_operations;rid uuid;g uuid;assigned_actor uuid;assigned_name text;creator text;h text;res jsonb;due date;begin
 r:=workforce_private.requests_locks(t,op);
 if change_text is null or octet_length(change_text)>40960 then raise exception using errcode='22023',message='Invalid request';end if;
 if workforce_private.forms_json_unique(change_text::json) is distinct from true then raise exception using errcode='22023',message='Duplicate request properties';end if;
 c:=change_text::jsonb;a:=c->>'action';
 if jsonb_typeof(c)<>'object' or octet_length(c::text)>40960 or a is null or a not in('create','edit','move') then raise exception using errcode='22023',message='Invalid request';end if;
 if a='move' then
 if c - array['action','requestId','revision','status']<>'{}'::jsonb or not c ?& array['action','requestId','revision','status'] or jsonb_typeof(c->'status')<>'string' or c->>'status' not in('new','in_progress','done') then raise exception using errcode='22023',message='Invalid request move';end if;
 else
 if c - (case when a='edit' then array['action','requestId','revision','title','description','priority','dueDate','assigneeAgentId','assigneeActorId'] else array['action','title','description','priority','dueDate','assigneeAgentId','assigneeActorId'] end)<>'{}'::jsonb or not c ?& array['action','title','description','priority','dueDate','assigneeAgentId','assigneeActorId'] or
 jsonb_typeof(c->'title')<>'string' or workforce_private.knowledge_utf16(c->>'title') not between 1 and 160 or workforce_private.knowledge_nonblank(c->>'title') is distinct from true or jsonb_typeof(c->'description')<>'string' or workforce_private.knowledge_utf16(c->>'description')>5000 or
 jsonb_typeof(c->'priority')<>'string' or c->>'priority' not in('low','normal','high') or jsonb_typeof(c->'dueDate') not in('string','null') or jsonb_typeof(c->'assigneeAgentId') not in('string','null') or jsonb_typeof(c->'assigneeActorId') not in('string','null') then raise exception using errcode='22023',message='Invalid request details';end if;
 if c->>'dueDate' is not null then
 if c->>'dueDate' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Invalid due date';end if;due:=(c->>'dueDate')::date;
 if due not between date '0001-01-01' and date '9999-12-31' or to_char(due,'YYYY-MM-DD')<>c->>'dueDate' then raise exception using errcode='22023',message='Invalid due date';end if;end if;
 g:=(c->>'assigneeAgentId')::uuid;assigned_actor:=(c->>'assigneeActorId')::uuid;
 if (g is null)<>(assigned_actor is null) then raise exception using errcode='22023',message='Capture both assignee identities';end if;
 end if;
 if a<>'create' then
 if not c ?& array['requestId','revision'] or jsonb_typeof(c->'revision')<>'number' or c->>'revision' !~ '^[1-9][0-9]{0,9}$' or (c->>'revision')::numeric>2147483646 then raise exception using errcode='22023',message='Invalid request revision';end if;
 rid:=(c->>'requestId')::uuid;select * into x from public.work_requests where tenant_id=t and id=rid for update;
 if not found then raise exception using errcode='42501',message='Request unavailable';end if;
 end if;
 if workforce_private.requests_change_access(t,rid,a) is distinct from true or (r not in('owner','admin') and a in('create','edit') and g is not null) then raise exception using errcode='42501',message='Request operation unavailable';end if;
 -- Existing assignment is pinned for moves; full edit replaces it only with an
 -- explicitly captured current eligible identity or null.
 if a='move' and x.assignee_agent_id is not null then g:=x.assignee_agent_id;assigned_actor:=x.assignee_actor_id;end if;
 if g is not null then
 perform 1 from public.agents where tenant_id=t and id=g for share;
 perform 1 from auth.users where id=assigned_actor for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=assigned_actor for share;
 if (a<>'move' or r not in('owner','admin')) and workforce_private.requests_eligible(t,g,assigned_actor) is distinct from true then raise exception using errcode='42501',message='Assignee unavailable';end if;
 select btrim(first_name||' '||last_name) into assigned_name from public.agents where tenant_id=t and id=g and user_id=assigned_actor;
 end if;
 if workforce_private.requests_change_access(t,rid,a) is distinct from true then raise exception using errcode='42501',message='Request operation unavailable';end if;
 h:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
 select * into rec from workforce_private.request_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then
 if rec.state='closed_absent' then raise exception using errcode='40001',message='Request operation closed or changed';end if;
 -- A create has no caller-supplied target. Bind receipt replay to the actual
 -- retained request before returning any acknowledgement, just as recovery does.
 select * into x from public.work_requests where tenant_id=t and id=rec.request_id for update;
 if x.assignee_agent_id is not null then
 perform 1 from public.agents where tenant_id=t and id=x.assignee_agent_id for share;
 perform 1 from auth.users where id=x.assignee_actor_id for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=x.assignee_actor_id for share;end if;
 if workforce_private.requests_change_access(t,rec.request_id,a) is distinct from true then raise exception using errcode='42501',message='Request operation unavailable';end if;
 if rec.action<>a or rec.payload_hash<>h then raise exception using errcode='40001',message='Request operation closed or changed';end if;
 return rec.result||jsonb_build_object('role',r);end if;
 if a<>'create' and x.revision<>(c->>'revision')::integer then raise exception using errcode='40001',message='Request changed';end if;
 if a='create' then
 select display_name into creator from public.tenant_memberships where tenant_id=t and user_id=actor;
 insert into public.work_requests(tenant_id,title,description,priority,due_date,status,revision,requester_id,requester_name,assignee_agent_id,assignee_actor_id,assignee_name)
 values(t,c->>'title',c->>'description',c->>'priority',due,'new',1,actor,creator,g,assigned_actor,assigned_name) returning * into x;
 elsif a='edit' then
 update public.work_requests set title=c->>'title',description=c->>'description',priority=c->>'priority',due_date=due,assignee_agent_id=g,assignee_actor_id=assigned_actor,assignee_name=assigned_name,revision=revision+1,updated_at=clock_timestamp() where tenant_id=t and id=rid returning * into x;
 else
 if x.status=c->>'status' then raise exception using errcode='22023',message='Choose another status';end if;
 update public.work_requests set status=c->>'status',revision=revision+1,updated_at=clock_timestamp() where tenant_id=t and id=rid returning * into x;
 end if;
 insert into public.work_request_audit(tenant_id,request_id,actor_id,action,revision,status) values(t,x.id,actor,a,x.revision,x.status);
 res:=jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',actor,'role',r,'operationId',op,'action',a,'requestId',x.id,'revision',x.revision,'status',x.status);
 insert into workforce_private.request_operations values(t,actor,op,a,'recorded',h,res,x.id);return res;
 end$$;
create function public.save_request(target_tenant uuid,operation_id uuid,change_text text) returns jsonb language sql volatile security invoker set search_path='' as $$select workforce_private.save_request(target_tenant,operation_id,change_text)$$;
create function workforce_private.reconcile_request_operation(t uuid,op uuid,a text) returns jsonb language plpgsql volatile security definer set search_path='' as $$
 declare r text;actor uuid:=auth.uid();rec workforce_private.request_operations;s jsonb;x public.work_requests;begin
 r:=workforce_private.requests_locks(t,op);
 if a is null or a not in('create','edit','move') then raise exception using errcode='22023',message='Invalid recovery action';end if;
 select * into rec from workforce_private.request_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then
 if rec.action<>a then raise exception using errcode='40001',message='Recovery action changed';end if;
 if rec.state='recorded' then
 select * into x from public.work_requests where tenant_id=t and id=rec.request_id for update;
 if x.assignee_agent_id is not null then
 perform 1 from public.agents where tenant_id=t and id=x.assignee_agent_id for share;
 perform 1 from auth.users where id=x.assignee_actor_id for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=x.assignee_actor_id for share;end if;
 if workforce_private.requests_change_access(t,rec.request_id,a) is distinct from true then raise exception using errcode='42501',message='Request operation unavailable';end if;
 s:=rec.result||jsonb_build_object('role',r);end if;
 else insert into workforce_private.request_operations(tenant_id,actor_id,operation_id,action,state) values(t,actor,op,a,'closed_absent');end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',actor,'role',r,'operationId',op,'action',a,'status',case when s is null then 'not_recorded' else 'recorded' end,'saved',s);
 end$$;
create function public.reconcile_request_operation(target_tenant uuid,operation_id uuid,action_name text) returns jsonb language sql volatile security invoker set search_path='' as $$select workforce_private.reconcile_request_operation(target_tenant,operation_id,action_name)$$;
-- Default grants are explicitly closed for every new function, including private
-- locking helpers. Only the guarded entry points and safe RLS/read helpers open.
do $$declare p record;begin for p in select oid::regprocedure f from pg_proc where pronamespace='workforce_private'::regnamespace and proname in('requests_eligible','requests_access','requests_change_access','requests_time','requests_card','requests_version','requests_locks','save_request','reconcile_request_operation') or pronamespace='public'::regnamespace and proname in('read_requests','read_requests_access','save_request','reconcile_request_operation') loop execute 'revoke all on function '||p.f||' from public,anon,authenticated,service_role';end loop;end$$;
grant execute on function workforce_private.requests_eligible(uuid,uuid,uuid),workforce_private.requests_access(uuid,uuid),workforce_private.requests_change_access(uuid,uuid,text),workforce_private.requests_time(timestamptz),workforce_private.requests_card(public.work_requests),workforce_private.requests_version(uuid,boolean),workforce_private.save_request(uuid,uuid,text),workforce_private.reconcile_request_operation(uuid,uuid,text),public.read_requests(uuid,text,text,integer,text,jsonb,uuid),public.read_requests_access(uuid,text,uuid,text),public.save_request(uuid,uuid,text),public.reconcile_request_operation(uuid,uuid,text) to authenticated;
