begin;
create table public.time_off_types (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 name text not null check(length(btrim(name)) between 1 and 100),description text not null check(length(description)<=1000),paid boolean not null,
 status text not null default 'active' check(status in ('active','archived')),revision integer not null default 1 check(revision>0),
 created_by uuid not null,created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id),foreign key(tenant_id,created_by) references public.tenant_memberships(tenant_id,user_id)
);
create unique index time_off_active_type_name on public.time_off_types(tenant_id,lower(btrim(name))) where status='active';
create table public.time_off_requests (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,agent_id uuid not null,agent_name text not null,
 type_id uuid not null,type_name text not null,type_description text not null,type_paid boolean not null,
 start_date date not null,end_date date not null,calendar_days integer generated always as (end_date-start_date+1) stored,
 note text not null check(length(note)<=2000),status text not null default 'pending' check(status in ('pending','approved','rejected','withdrawn','cancelled')),
 revision integer not null default 1 check(revision>0),requested_by uuid not null,requested_at timestamptz not null default clock_timestamp(),
 decision_by uuid,decision_name text,decision_reason text,decided_at timestamptz,
 unique(tenant_id,id),foreign key(tenant_id,agent_id) references public.agents(tenant_id,id),
 foreign key(tenant_id,type_id) references public.time_off_types(tenant_id,id),foreign key(tenant_id,requested_by) references public.tenant_memberships(tenant_id,user_id),
 foreign key(tenant_id,decision_by) references public.tenant_memberships(tenant_id,user_id),
 check(isfinite(start_date) and isfinite(end_date) and start_date>=date '0001-01-01' and end_date<=date '9999-12-31' and end_date-start_date between 0 and 365),
 check((status='pending' and decision_by is null and decision_name is null and decision_reason is null and decided_at is null) or (status<>'pending' and decision_by is not null and decision_name is not null and decided_at is not null and isfinite(decided_at))),
 check(status not in ('rejected','cancelled') or (decision_reason is not null and length(btrim(decision_reason))>0))
);
create index time_off_request_history on public.time_off_requests(tenant_id,requested_at desc,id desc);
create index time_off_request_agent on public.time_off_requests(tenant_id,agent_id,requested_at desc,id desc);
create index time_off_request_type on public.time_off_requests(tenant_id,type_id);
create index time_off_request_creator on public.time_off_requests(tenant_id,requested_by);
create index time_off_request_decision_actor on public.time_off_requests(tenant_id,decision_by);
create table public.time_off_audit (
 id bigint generated always as identity primary key,tenant_id uuid not null,request_id uuid,type_id uuid not null,
 actor_user_id uuid not null,actor_name text not null,operation_id uuid not null,action text not null check(action in ('create_type','archive_type','request','approve','reject','withdraw','cancel')),
 revision integer not null,reason text,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,request_id) references public.time_off_requests(tenant_id,id),foreign key(tenant_id,type_id) references public.time_off_types(tenant_id,id),
 foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id),unique(tenant_id,actor_user_id,operation_id)
);
create index time_off_audit_request on public.time_off_audit(tenant_id,request_id,revision);
create index time_off_audit_type on public.time_off_audit(tenant_id,type_id);
create table workforce_private.time_off_operations (
 tenant_id uuid not null,actor_user_id uuid not null,operation_id uuid not null,change jsonb not null,result jsonb not null,
 primary key(tenant_id,actor_user_id,operation_id),foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.time_off_operations enable row level security;
revoke all on workforce_private.time_off_operations from public,anon,authenticated,service_role;
-- Guarded private helpers avoid request/audit recursion and never accept a
-- caller-chosen actor. Current Auth identity AND original requester are required.
create function workforce_private.time_off_request_access(t uuid,k uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) in ('owner','admin') or
 (workforce_private.membership_role(t) is not null and exists(select 1 from public.time_off_requests r join public.agents g on g.tenant_id=r.tenant_id and g.id=r.agent_id where r.tenant_id=t and r.id=k and r.requested_by=auth.uid() and g.user_id=auth.uid() and g.status='active')),false)
$$;
create function workforce_private.time_off_requester_active(t uuid,k uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select workforce_private.time_off_request_access(t,k) and exists(select 1 from public.time_off_requests r join public.agents g on g.tenant_id=r.tenant_id and g.id=r.agent_id join public.tenant_memberships m on m.tenant_id=r.tenant_id and m.user_id=r.requested_by join auth.users u on u.id=m.user_id where r.tenant_id=t and r.id=k and g.status='active' and g.user_id=r.requested_by and m.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true)
$$;
revoke all on function workforce_private.time_off_request_access(uuid,uuid),workforce_private.time_off_requester_active(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function workforce_private.time_off_request_access(uuid,uuid),workforce_private.time_off_requester_active(uuid,uuid) to authenticated;
alter table public.time_off_types enable row level security;
alter table public.time_off_requests enable row level security;
alter table public.time_off_audit enable row level security;
revoke all on public.time_off_types,public.time_off_requests,public.time_off_audit from public,anon,authenticated,service_role;
grant select on public.time_off_types,public.time_off_requests,public.time_off_audit to authenticated;
revoke all on sequence public.time_off_audit_id_seq from public,anon,authenticated,service_role;
create policy time_off_types_read on public.time_off_types for select to authenticated using(workforce_private.membership_role(tenant_id) is not null and (status='active' or workforce_private.membership_role(tenant_id) in ('owner','admin')));
create policy time_off_requests_read on public.time_off_requests for select to authenticated using(workforce_private.time_off_request_access(tenant_id,id));
create policy time_off_audit_read on public.time_off_audit for select to authenticated using(workforce_private.membership_role(tenant_id) in ('owner','admin') or (request_id is not null and workforce_private.time_off_request_access(tenant_id,request_id)));

create function workforce_private.save_time_off(target_tenant uuid,operation_id uuid,change jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid();role_name text;actor_name text;op text:=change->>'action';agent public.agents%rowtype;
 leave_type public.time_off_types%rowtype;request public.time_off_requests%rowtype;previous workforce_private.time_off_operations%rowtype;
 allowed text[];expected integer;first_date date;last_date date;reason text;result jsonb;management boolean;
begin
 if actor is null or operation_id is null or jsonb_typeof(change) is distinct from 'object' or octet_length(change::text)>24000 or op is null or op not in ('create_type','archive_type','request','withdraw','approve','reject','cancel') then raise exception using errcode='22023',message='Invalid time off action';end if;
 -- Type changes serialize through the company mutex. Request/decision writes
 -- hold it shared plus the agent row exclusively; overlap checks for one agent
 -- cannot race, while separate agents can be reviewed concurrently.
 if op in ('create_type','archive_type') then perform 1 from public.tenants where id=target_tenant and status='active' for update;
 else perform 1 from public.tenants where id=target_tenant and status='active' for share;end if;
 if not found then raise exception using errcode='42501',message='Company access unavailable';end if;
 perform 1 from auth.users where id=actor for share;
 select display_name into actor_name from public.tenant_memberships where tenant_id=target_tenant and user_id=actor and status='active' for share;
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null then raise exception using errcode='42501',message='Company access unavailable';end if;
 management:=op in ('create_type','archive_type','approve','reject','cancel');
 if management and role_name not in ('owner','admin') then raise exception using errcode='42501',message='Owners and admins manage time off';end if;
 if not management then
  select * into agent from public.agents where tenant_id=target_tenant and user_id=actor and status='active' for update;
  if not found then raise exception using errcode='42501',message='An active linked agent is required';end if;
  if op='request' and (change->>'agentId')::uuid is distinct from agent.id then raise exception using errcode='42501',message='Request was prepared for another linked agent';end if;
 end if;
 if op in ('withdraw','approve','reject','cancel') then
  select * into request from public.time_off_requests where tenant_id=target_tenant and id=(change->>'requestId')::uuid;
  if not found or (not management and (request.agent_id<>agent.id or request.requested_by<>actor)) then raise exception using errcode='42501',message='Current original requester required';end if;
  if management then select * into agent from public.agents where tenant_id=target_tenant and id=request.agent_id for update;end if;
  select * into request from public.time_off_requests where tenant_id=target_tenant and id=request.id for update;
 elsif op='archive_type' then
  select * into leave_type from public.time_off_types where tenant_id=target_tenant and id=(change->>'typeId')::uuid for update;
  if not found then raise exception using errcode='42501',message='Leave type unavailable';end if;
 end if;
 -- Authorization precedes cached acknowledgements. A personal create receipt
 -- must still belong to this original actor's current linked agent.
 select * into previous from workforce_private.time_off_operations r where r.tenant_id=target_tenant and r.actor_user_id=actor and r.operation_id=save_time_off.operation_id;
 if found then
  if not management and not exists(select 1 from public.time_off_requests r where r.tenant_id=target_tenant and r.id=(previous.result->>'requestId')::uuid and r.requested_by=actor and r.agent_id=agent.id) then raise exception using errcode='42501',message='Receipt belongs to an earlier linked identity';end if;
  if previous.change is distinct from change then raise exception using errcode='40001',message='Operation ID already used for another change';end if;
  return previous.result;
 end if;
 allowed:=case op when 'create_type' then array['action','name','description','paid'] when 'archive_type' then array['action','typeId','revision'] when 'request' then array['action','agentId','typeId','startDate','endDate','note'] when 'withdraw' then array['action','requestId','revision'] else array['action','requestId','revision','reason'] end;
 if exists(select 1 from jsonb_object_keys(change) k where k<>all(allowed)) then raise exception using errcode='22023',message='Unknown time off field';end if;
 if op in ('archive_type','withdraw','approve','reject','cancel') then
  expected:=case when op='archive_type' then leave_type.revision else request.revision end;
  if jsonb_typeof(change->'revision') is distinct from 'number' or (change->>'revision') !~ '^[1-9][0-9]{0,9}$' or (change->>'revision')::integer<>expected then raise exception using errcode='40001',message='Time off changed. Reload before continuing';end if;
 end if;
 if op='create_type' then
  if jsonb_typeof(change->'name') is distinct from 'string' or length(btrim(change->>'name')) not between 1 and 100 or jsonb_typeof(change->'description') is distinct from 'string' or length(change->>'description')>1000 or jsonb_typeof(change->'paid') is distinct from 'boolean' then raise exception using errcode='22023',message='Enter valid leave type details';end if;
  if (select count(*) from public.time_off_types where tenant_id=target_tenant and status='active')>=100 then raise exception using errcode='22023',message='Archive an unused type before creating more';end if;
  insert into public.time_off_types(tenant_id,name,description,paid,created_by) values(target_tenant,btrim(change->>'name'),change->>'description',(change->>'paid')::boolean,actor) returning * into leave_type;
 elsif op='archive_type' then
  if leave_type.status<>'active' then raise exception using errcode='40001',message='Leave type already archived';end if;
  update public.time_off_types set status='archived',revision=revision+1 where id=leave_type.id returning * into leave_type;
 elsif op='request' then
  select * into leave_type from public.time_off_types where tenant_id=target_tenant and id=(change->>'typeId')::uuid and status='active' for share;
  if not found then raise exception using errcode='22023',message='Choose an active leave type';end if;
  if jsonb_typeof(change->'note') is distinct from 'string' or length(change->>'note')>2000 or jsonb_typeof(change->'startDate') is distinct from 'string' or jsonb_typeof(change->'endDate') is distinct from 'string' or (change->>'startDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (change->>'endDate') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Choose real calendar dates and a note';end if;
  first_date:=(change->>'startDate')::date;last_date:=(change->>'endDate')::date;
  if first_date<date '0001-01-01' or last_date>date '9999-12-31' or last_date-first_date not between 0 and 365 then raise exception using errcode='22023',message='Choose up to366 inclusive calendar days';end if;
  if exists(select 1 from public.time_off_requests r where r.tenant_id=target_tenant and r.agent_id=agent.id and r.status='approved' and r.start_date<=last_date and r.end_date>=first_date) then raise exception using errcode='40001',message='Approved time off overlaps these dates';end if;
  insert into public.time_off_requests(tenant_id,agent_id,agent_name,type_id,type_name,type_description,type_paid,start_date,end_date,note,requested_by) values(target_tenant,agent.id,agent.first_name||' '||agent.last_name,leave_type.id,leave_type.name,leave_type.description,leave_type.paid,first_date,last_date,change->>'note',actor) returning * into request;
 else
  if (op='cancel' and request.status<>'approved') or (op<>'cancel' and request.status<>'pending') then raise exception using errcode='40001',message='Request status changed';end if;
  if op in ('approve','reject','cancel') then
   if jsonb_typeof(change->'reason') is distinct from 'string' or length(change->>'reason')>1000 or (op in ('reject','cancel') and length(btrim(change->>'reason'))=0) then raise exception using errcode='22023',message='Enter a decision reason';end if;
   reason:=btrim(change->>'reason');
  end if;
  if op='approve' then
   perform 1 from public.tenant_memberships where tenant_id=target_tenant and user_id=request.requested_by for share;
   perform 1 from auth.users where id=request.requested_by for share;
   if not workforce_private.time_off_requester_active(target_tenant,request.id) then raise exception using errcode='42501',message='Original requester is no longer active and linked';end if;
   if exists(select 1 from public.time_off_requests r where r.tenant_id=target_tenant and r.agent_id=request.agent_id and r.id<>request.id and r.status='approved' and r.start_date<=request.end_date and r.end_date>=request.start_date) then raise exception using errcode='40001',message='Approved time off overlaps these dates';end if;
  end if;
  update public.time_off_requests set status=case op when 'approve' then 'approved' when 'reject' then 'rejected' when 'withdraw' then 'withdrawn' else 'cancelled' end,revision=revision+1,decision_by=actor,decision_name=actor_name,decision_reason=reason,decided_at=clock_timestamp() where id=request.id returning * into request;
 end if;
 result:=jsonb_build_object('operationId',operation_id,'action',op,'typeId',case when management and op in ('create_type','archive_type') then leave_type.id else request.type_id end,'revision',case when op in ('create_type','archive_type') then leave_type.revision else request.revision end);
 if request.id is not null then result:=result||jsonb_build_object('requestId',request.id);end if;
 insert into public.time_off_audit(tenant_id,request_id,type_id,actor_user_id,actor_name,operation_id,action,revision,reason) values(target_tenant,request.id,(result->>'typeId')::uuid,actor,actor_name,operation_id,op,(result->>'revision')::integer,reason);
 insert into workforce_private.time_off_operations values(target_tenant,actor,operation_id,change,result);
 return result;
end;$$;
revoke all on function workforce_private.save_time_off(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function workforce_private.save_time_off(uuid,uuid,jsonb) to authenticated;
create function public.save_time_off(target_tenant uuid,operation_id uuid,change jsonb) returns jsonb language sql security invoker set search_path='' as $$select workforce_private.save_time_off(target_tenant,operation_id,change)$$;
revoke all on function public.save_time_off(uuid,uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.save_time_off(uuid,uuid,jsonb) to authenticated;
-- Small signed snapshot used both inside reads and for the fresh post-read
-- authorization check. It exposes only the caller's current company identity.
create function public.read_time_off_access(target_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare role_name text;company public.tenants%rowtype;agent public.agents%rowtype;
begin
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null or auth.uid() is null then raise exception using errcode='42501',message='Company access unavailable';end if;
 select * into company from public.tenants where id=target_tenant and status='active';
 select * into agent from public.agents where tenant_id=target_tenant and user_id=auth.uid() and status='active';
 return jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'time_zone',company.time_zone),'role',role_name,'actorId',auth.uid(),'agent',case when agent.id is null then null else jsonb_build_object('id',agent.id,'name',agent.first_name||' '||agent.last_name) end);
end;$$;
revoke all on function public.read_time_off_access(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_time_off_access(uuid) to authenticated;
create function workforce_private.time_off_request_json(k uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(r)||jsonb_build_object('history',coalesce((select jsonb_agg(jsonb_build_object('action',a.action,'actor_name',a.actor_name,'occurred_at',a.occurred_at,'revision',a.revision,'reason',a.reason) order by a.revision) from public.time_off_audit a where a.tenant_id=r.tenant_id and a.request_id=r.id),'[]'::jsonb),
 'canWithdraw',r.status='pending' and r.requested_by=auth.uid() and exists(select 1 from public.agents g where g.tenant_id=r.tenant_id and g.id=r.agent_id and g.user_id=auth.uid() and g.status='active'),
 'canApprove',r.status='pending' and workforce_private.membership_role(r.tenant_id) in ('owner','admin') and workforce_private.time_off_requester_active(r.tenant_id,r.id) and not exists(select 1 from public.time_off_requests other where other.tenant_id=r.tenant_id and other.agent_id=r.agent_id and other.id<>r.id and other.status='approved' and other.start_date<=r.end_date and other.end_date>=r.start_date),
 'canReject',r.status='pending' and workforce_private.membership_role(r.tenant_id) in ('owner','admin'),'canCancel',r.status='approved' and workforce_private.membership_role(r.tenant_id) in ('owner','admin')) from public.time_off_requests r where r.id=k
$$;
revoke all on function workforce_private.time_off_request_json(uuid) from public,anon,authenticated,service_role;
grant execute on function workforce_private.time_off_request_json(uuid) to authenticated;
create function public.read_time_off(target_tenant uuid,view_mode text default 'mine',state_filter text default 'all',search_text text default '',page_limit integer default 50,filter_agent uuid default null,filter_type uuid default null,start_date date default null,end_date date default null,after_request jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare access jsonb;current_agent_id uuid;actor uuid:=auth.uid();capable boolean;instant timestamptz:=statement_timestamp();types jsonb;counts jsonb;requests jsonb;page_ids uuid[];next_cursor jsonb;cursor_time timestamptz;cursor_id uuid;
begin
 access:=public.read_time_off_access(target_tenant);capable:=access->>'role' in ('owner','admin');current_agent_id:=(access->'agent'->>'id')::uuid;
 if view_mode is null or view_mode not in ('mine','team') or state_filter is null or state_filter not in ('all','pending','approved','rejected','withdrawn','cancelled') or search_text is null or length(search_text)>100 or page_limit is null or page_limit not between 1 and 100 or (start_date is null)<>(end_date is null) or (start_date is not null and (not isfinite(start_date) or not isfinite(end_date) or start_date<date '0001-01-01' or end_date>date '9999-12-31' or end_date-start_date not between 0 and 365)) then raise exception using errcode='22023',message='Invalid time off filters';end if;
 if view_mode='team' and not capable or (view_mode='mine' and filter_agent is not null and filter_agent is distinct from current_agent_id) then raise exception using errcode='42501',message='This time off view is unavailable';end if;
 if after_request is not null then
  if jsonb_typeof(after_request) is distinct from 'object' or octet_length(after_request::text)>2400 or (after_request->>'tenantId') is distinct from target_tenant::text or (after_request->>'actorId') is distinct from actor::text or (after_request->>'agentId') is distinct from current_agent_id::text or (after_request->>'role') is distinct from access->>'role' or (after_request->>'view') is distinct from view_mode or (after_request->>'status') is distinct from state_filter or (after_request->>'search') is distinct from search_text or (after_request->>'filterAgent') is distinct from filter_agent::text or (after_request->>'typeId') is distinct from filter_type::text or (after_request->>'startDate') is distinct from start_date::text or (after_request->>'endDate') is distinct from end_date::text or (after_request->>'timeZone') is distinct from access->'company'->>'time_zone' then raise exception using errcode='22023',message='Time off filters or current identity changed';end if;
  cursor_time:=(after_request->>'requestedAt')::timestamptz;cursor_id:=(after_request->>'requestId')::uuid;
  if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then raise exception using errcode='22023',message='Invalid time off cursor';end if;
 end if;
 select coalesce(jsonb_agg((to_jsonb(t)-'tenant_id'-'created_by'-'created_at')||jsonb_build_object('canArchive',capable) order by lower(t.name),t.id),'[]'::jsonb) into types from public.time_off_types t where t.tenant_id=target_tenant and t.status='active';
 -- This stable statement counts the complete RLS-filtered scope before status
 -- selection. It never truncates through a directory or current result page.
 select jsonb_build_object('total',count(*),'pending',count(*) filter(where r.status='pending'),'approved',count(*) filter(where r.status='approved'),'rejected',count(*) filter(where r.status='rejected'),'withdrawn',count(*) filter(where r.status='withdrawn'),'cancelled',count(*) filter(where r.status='cancelled')) into counts from public.time_off_requests r where r.tenant_id=target_tenant and (view_mode='team' or (r.agent_id=current_agent_id and r.requested_by=actor)) and (filter_agent is null or r.agent_id=filter_agent) and (filter_type is null or r.type_id=filter_type) and (read_time_off.start_date is null or (r.start_date<=read_time_off.end_date and r.end_date>=read_time_off.start_date)) and (search_text='' or strpos(lower(r.agent_name||' '||r.type_name||' '||r.note),lower(search_text))>0);
 select array_agg(p.id order by p.requested_at desc,p.id desc) into page_ids from (
  select r.id,r.requested_at from public.time_off_requests r where r.tenant_id=target_tenant and (view_mode='team' or (r.agent_id=current_agent_id and r.requested_by=actor)) and (filter_agent is null or r.agent_id=filter_agent) and (filter_type is null or r.type_id=filter_type) and (read_time_off.start_date is null or (r.start_date<=read_time_off.end_date and r.end_date>=read_time_off.start_date)) and (search_text='' or strpos(lower(r.agent_name||' '||r.type_name||' '||r.note),lower(search_text))>0) and (state_filter='all' or r.status=state_filter) and (after_request is null or (r.requested_at,r.id)<(cursor_time,cursor_id)) order by r.requested_at desc,r.id desc limit page_limit+1
 )p;
 select coalesce(jsonb_agg(workforce_private.time_off_request_json(u.id) order by u.ordinality),'[]'::jsonb) into requests from unnest(page_ids[1:page_limit]) with ordinality u(id,ordinality);
 if cardinality(page_ids)>page_limit then select jsonb_build_object('tenantId',target_tenant,'actorId',actor,'agentId',current_agent_id,'role',access->>'role','view',view_mode,'status',state_filter,'search',search_text,'filterAgent',filter_agent,'typeId',filter_type,'startDate',read_time_off.start_date,'endDate',read_time_off.end_date,'timeZone',access->'company'->>'time_zone','requestedAt',r.requested_at,'requestId',r.id) into next_cursor from public.time_off_requests r where r.id=page_ids[page_limit];end if;
 return access||jsonb_build_object('types',types,'requests',requests,'counts',counts,'nextCursor',next_cursor,'serverTime',instant,'timeZone',access->'company'->>'time_zone','capabilities',jsonb_build_object('canRequest',current_agent_id is not null,'canManageTypes',capable,'canViewTeam',capable));
end;$$;
revoke all on function public.read_time_off(uuid,text,text,text,integer,uuid,uuid,date,date,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.read_time_off(uuid,text,text,text,integer,uuid,uuid,date,date,jsonb) to authenticated;
commit;
