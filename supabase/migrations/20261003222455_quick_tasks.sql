begin;
create table public.quick_tasks (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 title text not null check(length(btrim(title)) between 1 and 150),description text not null default '' check(length(description)<=5000),
 mode text not null check(mode in ('group','separate')),publication text not null check(publication in ('draft','published')),
 status text not null default 'open' check(status in ('open','done')),archived boolean not null default false,
 start_date date,due_date date,created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 completed_by uuid,completed_name text,completed_at timestamptz,revision integer not null default 1 check(revision>0),batch_id uuid not null,
 unique(tenant_id,id),foreign key(tenant_id,created_by) references public.tenant_memberships(tenant_id,user_id),
 foreign key(tenant_id,completed_by) references public.tenant_memberships(tenant_id,user_id),
 check(start_date is null or (isfinite(start_date) and start_date between date '0001-01-01' and date '9999-12-31')),
 check(due_date is null or (isfinite(due_date) and due_date between date '0001-01-01' and date '9999-12-31')),
 check(start_date is null or due_date is null or start_date<=due_date),
 check((status='open' and completed_by is null and completed_name is null and completed_at is null) or (status='done' and completed_by is not null and completed_name is not null and completed_at is not null and isfinite(completed_at)))
);
create index quick_task_history on public.quick_tasks(tenant_id,created_at desc,id desc);
create index quick_task_creator on public.quick_tasks(tenant_id,created_by,created_at desc,id desc);
create index quick_task_completion_actor on public.quick_tasks(tenant_id,completed_by);
create table public.quick_task_assignees (
 tenant_id uuid not null,task_id uuid not null,agent_id uuid not null,agent_name text not null,
 primary key(tenant_id,task_id,agent_id),foreign key(tenant_id,task_id) references public.quick_tasks(tenant_id,id),
 foreign key(tenant_id,agent_id) references public.agents(tenant_id,id)
);
create index quick_task_agent_lookup on public.quick_task_assignees(tenant_id,agent_id,task_id);
create table public.quick_task_audit (
 id bigint generated always as identity primary key,tenant_id uuid not null,task_id uuid not null,actor_user_id uuid not null,
 operation_id uuid not null,action text not null check(action in ('create','edit','publish','complete','reopen','archive','restore')),
 revision integer not null,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,task_id) references public.quick_tasks(tenant_id,id),foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id),
 unique(tenant_id,actor_user_id,operation_id,task_id)
);
create index quick_task_audit_actor on public.quick_task_audit(tenant_id,actor_user_id);
create table workforce_private.quick_task_operations (
 tenant_id uuid not null,actor_user_id uuid not null,operation_id uuid not null,change jsonb not null,result jsonb not null,
 primary key(tenant_id,actor_user_id,operation_id),foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.quick_task_operations enable row level security;
revoke all on workforce_private.quick_task_operations from public,anon,authenticated;
-- Small guarded helper avoids recursive tasks/assignment RLS without exposing
-- caller-chosen identities or granting direct writes to any browser role.
create function workforce_private.quick_task_access(t uuid,k uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) in ('owner','admin') or
 (workforce_private.membership_role(t) is not null and exists(select 1 from public.quick_tasks q join public.quick_task_assignees a on a.tenant_id=q.tenant_id and a.task_id=q.id join public.agents g on g.tenant_id=a.tenant_id and g.id=a.agent_id where q.tenant_id=t and q.id=k and q.publication='published' and not q.archived and g.status='active' and g.user_id=auth.uid())),false)
$$;
revoke all on function workforce_private.quick_task_access(uuid,uuid) from public,anon,authenticated;
grant execute on function workforce_private.quick_task_access(uuid,uuid) to authenticated;
alter table public.quick_tasks enable row level security;
alter table public.quick_task_assignees enable row level security;
alter table public.quick_task_audit enable row level security;
revoke all on public.quick_tasks,public.quick_task_assignees,public.quick_task_audit from public,anon,authenticated;
grant select on public.quick_tasks,public.quick_task_assignees,public.quick_task_audit to authenticated;
revoke all on sequence public.quick_task_audit_id_seq from public,anon,authenticated;
create policy quick_tasks_read on public.quick_tasks for select to authenticated using(workforce_private.quick_task_access(tenant_id,id));
create policy quick_task_assignees_read on public.quick_task_assignees for select to authenticated using(workforce_private.quick_task_access(tenant_id,task_id));
create policy quick_task_audit_read on public.quick_task_audit for select to authenticated using(workforce_private.membership_role(tenant_id) in ('owner','admin'));
create function workforce_private.quick_task_overdue(d date,z text,instant timestamptz) returns boolean
language sql stable security invoker set search_path='' as $$select coalesce(d<(instant at time zone z)::date,false)$$;
revoke all on function workforce_private.quick_task_overdue(date,text,timestamptz) from public,anon,authenticated;
grant execute on function workforce_private.quick_task_overdue(date,text,timestamptz) to authenticated;

create function workforce_private.save_quick_task(target_tenant uuid,operation_id uuid,change jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();role_name text;op text:=change->>'action';q public.quick_tasks%rowtype;
 previous workforce_private.quick_task_operations%rowtype;ids uuid[];target uuid;batch uuid:=gen_random_uuid();expected integer;
 selected uuid[];saved jsonb:='[]';result jsonb;allowed text[];actor_name text;
begin
 perform 1 from public.tenants where id=target_tenant and status='active' for update;
 if not found or actor is null then raise exception using errcode='42501',message='Company access unavailable';end if;
 select display_name into actor_name from public.tenant_memberships where tenant_id=target_tenant and user_id=actor and status='active' for share;
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null then raise exception using errcode='42501',message='Company access unavailable';end if;
 if operation_id is null or jsonb_typeof(change) is distinct from 'object' or octet_length(change::text)>16000 or op is null or op not in ('create','edit','publish','complete','reopen','archive','restore') then raise exception using errcode='22023',message='Invalid task action';end if;
 if op<>'complete' and role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins manage tasks';end if;
 if op<>'create' then
  select * into q from public.quick_tasks where tenant_id=target_tenant and id=(change->>'taskId')::uuid for update;
  if not found or not workforce_private.quick_task_access(target_tenant,q.id) then raise exception using errcode='42501',message='Task access unavailable';end if;
  if op='complete' and role_name not in ('owner','admin') then
   perform 1 from public.agents g join public.quick_task_assignees a on a.tenant_id=g.tenant_id and a.agent_id=g.id where g.tenant_id=target_tenant and a.task_id=q.id and g.user_id=actor and g.status='active' for share of g;
   if not found then raise exception using errcode='42501',message='Current task assignment required';end if;
  end if;
 end if;
 select * into previous from workforce_private.quick_task_operations r where r.tenant_id=target_tenant and r.actor_user_id=actor and r.operation_id=save_quick_task.operation_id;
 if found then
  if previous.change is distinct from change then raise exception using errcode='40001',message='Operation ID already used for another task change';end if;
  return previous.result;
 end if;
 allowed:=case op when 'create' then array['action','title','description','mode','publication','agentIds','startDate','dueDate'] when 'edit' then array['action','taskId','revision','title','description','agentIds','startDate','dueDate'] else array['action','taskId','revision'] end;
 if exists(select 1 from jsonb_object_keys(change) k where k<>all(allowed)) then raise exception using errcode='22023',message='Unknown task field';end if;
 if op<>'create' then
  if jsonb_typeof(change->'revision') is distinct from 'number' or (change->>'revision') !~ '^[1-9][0-9]{0,9}$' or (change->>'revision')::integer<>q.revision then raise exception using errcode='40001',message='Task changed. Reload before continuing';end if;
  if q.archived and op<>'restore' then raise exception using errcode='40001',message='Restore the task before changing it';end if;
 end if;
 if op in ('create','edit','publish') then
  if op='publish' then
   select array_agg(agent_id) into ids from public.quick_task_assignees where tenant_id=target_tenant and task_id=q.id;
  else
   if jsonb_typeof(change->'title') is distinct from 'string' or length(btrim(change->>'title')) not between 1 and 150 or jsonb_typeof(change->'description') is distinct from 'string' or length(change->>'description')>5000 or jsonb_typeof(change->'agentIds') is distinct from 'array' or jsonb_array_length(change->'agentIds') not between 1 and 25 then raise exception using errcode='22023',message='Enter task details and assignees';end if;
   select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(change->'agentIds');
   if cardinality(ids)<>jsonb_array_length(change->'agentIds') then raise exception using errcode='22023',message='Choose each assignee once';end if;
   if op='edit' and q.mode='separate' and cardinality(ids)<>1 then raise exception using errcode='22023',message='Individual tasks keep one assignee';end if;
   if (change->'startDate' is distinct from 'null'::jsonb and (jsonb_typeof(change->'startDate') is distinct from 'string' or (change->>'startDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) or (change->'dueDate' is distinct from 'null'::jsonb and (jsonb_typeof(change->'dueDate') is distinct from 'string' or (change->>'dueDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$')) then raise exception using errcode='22023',message='Choose calendar dates';end if;
  end if;
  perform 1 from public.agents where tenant_id=target_tenant and id=any(ids) for share;
  perform 1 from public.tenant_memberships m join public.agents g on g.tenant_id=m.tenant_id and g.user_id=m.user_id where g.tenant_id=target_tenant and g.id=any(ids) for share of m;
  if (select count(*) from public.agents g join public.tenant_memberships m on m.tenant_id=g.tenant_id and m.user_id=g.user_id where g.tenant_id=target_tenant and g.id=any(ids) and g.status='active' and m.status='active')<>cardinality(ids) or ids is null then raise exception using errcode='22023',message='Assignees must be active linked company users';end if;
 end if;
 if op='create' then
  if change->>'mode' not in ('group','separate') or change->>'publication' not in ('draft','published') or change->>'mode' is null or change->>'publication' is null then raise exception using errcode='22023',message='Choose shared group or separate individual tasks';end if;
  selected:=case when change->>'mode'='separate' then ids else array[ids[1]] end;
  foreach target in array selected loop
   insert into public.quick_tasks(tenant_id,title,description,mode,publication,start_date,due_date,created_by,batch_id) values(target_tenant,btrim(change->>'title'),change->>'description',change->>'mode',change->>'publication',(change->>'startDate')::date,(change->>'dueDate')::date,actor,batch) returning * into q;
   insert into public.quick_task_assignees select target_tenant,q.id,g.id,g.first_name||' '||g.last_name from public.agents g where g.tenant_id=target_tenant and g.id=any(case when q.mode='group' then ids else array[target] end);
   saved:=saved||jsonb_build_array(jsonb_build_object('id',q.id,'revision',q.revision));
   insert into public.quick_task_audit(tenant_id,task_id,actor_user_id,operation_id,action,revision) values(target_tenant,q.id,actor,operation_id,op,q.revision);
  end loop;
 else
  if op='edit' then
   update public.quick_tasks set title=btrim(change->>'title'),description=change->>'description',start_date=(change->>'startDate')::date,due_date=(change->>'dueDate')::date where id=q.id;
   delete from public.quick_task_assignees where tenant_id=target_tenant and task_id=q.id;
   insert into public.quick_task_assignees select target_tenant,q.id,g.id,g.first_name||' '||g.last_name from public.agents g where g.tenant_id=target_tenant and g.id=any(ids);
  elsif op='publish' then
   if q.publication<>'draft' then raise exception using errcode='40001',message='Task is already published';end if;
   update public.quick_tasks set publication='published' where id=q.id;
  elsif op in ('complete','reopen') then
   if q.publication<>'published' or (op='complete' and q.status<>'open') or (op='reopen' and q.status<>'done') then raise exception using errcode='40001',message='Task status changed';end if;
   update public.quick_tasks set status=case op when 'complete' then 'done' else 'open' end,completed_by=case when op='complete' then actor else null end,completed_name=case when op='complete' then actor_name else null end,completed_at=case when op='complete' then clock_timestamp() else null end where id=q.id;
  elsif op='archive' then update public.quick_tasks set archived=true where id=q.id;
  else
   if not q.archived then raise exception using errcode='40001',message='Task is already active';end if;
   update public.quick_tasks set archived=false where id=q.id;
  end if;
  update public.quick_tasks set revision=revision+1 where id=q.id returning * into q;
  saved:=jsonb_build_array(jsonb_build_object('id',q.id,'revision',q.revision));
  insert into public.quick_task_audit(tenant_id,task_id,actor_user_id,operation_id,action,revision) values(target_tenant,q.id,actor,operation_id,op,q.revision);
 end if;
 result:=jsonb_build_object('operationId',operation_id,'action',op,'tasks',saved);
 insert into workforce_private.quick_task_operations values(target_tenant,actor,operation_id,change,result);
 return result;
end;$$;
revoke all on function workforce_private.save_quick_task(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function workforce_private.save_quick_task(uuid,uuid,jsonb) to authenticated;
create function public.save_quick_task(target_tenant uuid,operation_id uuid,change jsonb) returns jsonb language sql security invoker set search_path='' as $$select workforce_private.save_quick_task(target_tenant,operation_id,change)$$;
revoke all on function public.save_quick_task(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_quick_task(uuid,uuid,jsonb) to authenticated;
create function workforce_private.quick_task_json(task_id uuid,time_zone text,instant timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 select (to_jsonb(q)-'batch_id')||jsonb_build_object('assignees',coalesce((select jsonb_agg(jsonb_build_object('id',a.agent_id,'name',a.agent_name) order by a.agent_id) from public.quick_task_assignees a where a.tenant_id=q.tenant_id and a.task_id=q.id),'[]'::jsonb),'overdue',q.status='open' and q.publication='published' and not q.archived and workforce_private.quick_task_overdue(q.due_date,time_zone,instant),'canComplete',q.status='open' and q.publication='published' and not q.archived and workforce_private.quick_task_access(q.tenant_id,q.id)) from public.quick_tasks q where q.id=task_id
$$;
revoke all on function workforce_private.quick_task_json(uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function workforce_private.quick_task_json(uuid,text,timestamptz) to authenticated;
create function public.read_quick_task_assignees(target_tenant uuid,search_text text default '',page_limit integer default 100,after_agent jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();role_name text;agents jsonb;next_cursor jsonb;cursor_name text;cursor_id uuid;
begin
 role_name:=workforce_private.membership_role(target_tenant);
 if actor is null or role_name is null or role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins assign tasks';end if;
 if search_text is null or length(search_text)>100 or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid assignee filters';end if;
 if after_agent is not null then
  if jsonb_typeof(after_agent) is distinct from 'object' or octet_length(after_agent::text)>2048 or (after_agent->>'tenantId') is distinct from target_tenant::text or (after_agent->>'actorId') is distinct from actor::text or (after_agent->>'search') is distinct from search_text then raise exception using errcode='22023',message='Assignee filters changed';end if;
  cursor_name:=after_agent->>'name';cursor_id:=(after_agent->>'agentId')::uuid;
  if cursor_name is null or length(cursor_name)>256 or cursor_id is null then raise exception using errcode='22023',message='Invalid assignee cursor';end if;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name) order by p.sort_name,p.id),'[]'::jsonb) into agents from (
  select g.id,g.first_name||' '||g.last_name name,lower(g.first_name||' '||g.last_name) sort_name from public.agents g join public.tenant_memberships m on m.tenant_id=g.tenant_id and m.user_id=g.user_id
  where g.tenant_id=target_tenant and g.status='active' and m.status='active' and (search_text='' or strpos(lower(g.first_name||' '||g.last_name),lower(search_text))>0)
  and (after_agent is null or (lower(g.first_name||' '||g.last_name),g.id)>(cursor_name,cursor_id)) order by lower(g.first_name||' '||g.last_name),g.id limit page_limit+1
 )p;
 if jsonb_array_length(agents)>page_limit then
  next_cursor:=jsonb_build_object('tenantId',target_tenant,'actorId',actor,'search',search_text,'name',lower(agents->(page_limit-1)->>'name'),'agentId',agents->(page_limit-1)->>'id');
  agents:=agents- page_limit;
 end if;
 return jsonb_build_object('agents',agents,'nextCursor',next_cursor);
end;$$;
revoke all on function public.read_quick_task_assignees(uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.read_quick_task_assignees(uuid,text,integer,jsonb) to authenticated;
create function public.read_quick_tasks(target_tenant uuid,view_tab text default null,state_filter text default 'all',search_text text default '',overdue_only boolean default false,page_limit integer default 50,after_task jsonb default null,detail_id uuid default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();role_name text;company public.tenants%rowtype;agent public.agents%rowtype;instant timestamptz:=statement_timestamp();
 page_ids uuid[];counts jsonb;tasks jsonb;next_cursor jsonb;cursor_time timestamptz;cursor_id uuid;assignable jsonb;assignable_cursor jsonb;assignable_more boolean:=false;capable boolean;
begin
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null or actor is null then raise exception using errcode='42501',message='Company access unavailable';end if;
 select * into company from public.tenants where id=target_tenant and status='active';
 select * into agent from public.agents where tenant_id=target_tenant and user_id=actor and status='active';
 capable:=role_name in ('owner','admin');view_tab:=coalesce(view_tab,case when capable then 'all' else 'mine' end);
 if view_tab not in ('all','mine','created','archived') or state_filter is null or state_filter not in ('all','open','done') or search_text is null or length(search_text)>100 or overdue_only is null or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid task filters';end if;
 if not capable and view_tab<>'mine' then raise exception using errcode='42501',message='Only assigned tasks are available';end if;
 if detail_id is not null then
  if not workforce_private.quick_task_access(target_tenant,detail_id) or not exists(select 1 from public.quick_tasks where tenant_id=target_tenant and id=detail_id) then raise exception using errcode='42501',message='Task access unavailable';end if;
  return jsonb_build_object('task',workforce_private.quick_task_json(detail_id,company.time_zone,instant),'serverTime',instant,'timeZone',company.time_zone);
 end if;
 if after_task is not null then
  if jsonb_typeof(after_task) is distinct from 'object' or octet_length(after_task::text)>2048 or (after_task->>'tenantId') is distinct from target_tenant::text or (after_task->>'actorId') is distinct from actor::text or (after_task->>'agentId') is distinct from agent.id::text or (after_task->>'tab') is distinct from view_tab or (after_task->>'status') is distinct from state_filter or (after_task->>'search') is distinct from search_text or (after_task->>'overdue')::boolean is distinct from overdue_only or (after_task->>'timeZone') is distinct from company.time_zone then raise exception using errcode='22023',message='Task filters changed';end if;
  cursor_time:=(after_task->>'createdAt')::timestamptz;cursor_id:=(after_task->>'taskId')::uuid;
  if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then raise exception using errcode='22023',message='Invalid task cursor';end if;
 end if;
 -- Exact counts are computed before status selection and never from a capped
 -- directory/page. One stable invoker statement protects the read snapshot.
 select jsonb_build_object('total',count(*),'open',count(*) filter(where q.status='open'),'done',count(*) filter(where q.status='done'),'overdue',count(*) filter(where q.status='open' and q.publication='published' and not q.archived and workforce_private.quick_task_overdue(q.due_date,company.time_zone,instant))) into counts from public.quick_tasks q where q.tenant_id=target_tenant
 and (case view_tab when 'archived' then q.archived when 'created' then not q.archived and q.created_by=actor when 'mine' then not q.archived and q.publication='published' and exists(select 1 from public.quick_task_assignees a where a.tenant_id=target_tenant and a.task_id=q.id and a.agent_id=agent.id) else not q.archived end)
 and (search_text='' or strpos(lower(q.title),lower(search_text))>0 or strpos(lower(q.description),lower(search_text))>0)
 and (not overdue_only or (q.status='open' and q.publication='published' and not q.archived and workforce_private.quick_task_overdue(q.due_date,company.time_zone,instant)));
 select array_agg(p.id order by p.created_at desc,p.id desc) into page_ids from (select q.id,q.created_at from public.quick_tasks q where (q.tenant_id=target_tenant
 and (case view_tab when 'archived' then q.archived when 'created' then not q.archived and q.created_by=actor when 'mine' then not q.archived and q.publication='published' and exists(select 1 from public.quick_task_assignees a where a.tenant_id=target_tenant and a.task_id=q.id and a.agent_id=agent.id) else not q.archived end)
 and (search_text='' or strpos(lower(q.title),lower(search_text))>0 or strpos(lower(q.description),lower(search_text))>0)
 and (not overdue_only or (q.status='open' and q.publication='published' and not q.archived and workforce_private.quick_task_overdue(q.due_date,company.time_zone,instant)))) and (state_filter='all' or q.status=state_filter) and (after_task is null or (q.created_at,q.id)<(cursor_time,cursor_id)) order by q.created_at desc,q.id desc limit page_limit+1)p;
 select coalesce(jsonb_agg(workforce_private.quick_task_json(u.id,company.time_zone,instant) order by u.ordinality),'[]'::jsonb) into tasks from unnest(page_ids[1:page_limit]) with ordinality u(id,ordinality);
 if cardinality(page_ids)>page_limit then select jsonb_build_object('tenantId',target_tenant,'actorId',actor,'agentId',agent.id,'tab',view_tab,'status',state_filter,'search',search_text,'overdue',overdue_only,'timeZone',company.time_zone,'createdAt',q.created_at,'taskId',q.id) into next_cursor from public.quick_tasks q where q.id=page_ids[page_limit];end if;
 if capable then
  select x->'agents',x->'nextCursor',(x->>'nextCursor') is not null into assignable,assignable_cursor,assignable_more from (select public.read_quick_task_assignees(target_tenant,'',100,null) x) roster;
 else assignable:='[]';end if;
 return jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'time_zone',company.time_zone),'role',role_name,'actorId',actor,'agent',case when agent.id is null then null else jsonb_build_object('id',agent.id,'name',agent.first_name||' '||agent.last_name) end,'capabilities',jsonb_build_object('canCreate',capable,'canViewAll',capable,'canManage',capable),'assignableAgents',assignable,'assignableAgentsHasMore',assignable_more,'assignableAgentsCursor',assignable_cursor,'tasks',tasks,'counts',counts,'nextCursor',next_cursor,'serverTime',instant,'timeZone',company.time_zone);
end;$$;
revoke all on function public.read_quick_tasks(uuid,text,text,text,boolean,integer,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.read_quick_tasks(uuid,text,text,text,boolean,integer,jsonb,uuid) to authenticated;
commit;
