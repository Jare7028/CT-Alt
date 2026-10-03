begin;

create table public.time_clock_jobs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 name text not null check(length(btrim(name)) between 1 and 100),
 status text not null default 'active' check(status in ('active','archived')),
 revision integer not null default 1 check(revision>0), created_at timestamptz not null default clock_timestamp(),
 unique(tenant_id,id)
);
create unique index time_clock_active_job_name on public.time_clock_jobs(tenant_id,lower(btrim(name))) where status='active';
create table public.time_clock_entries (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 agent_id uuid not null, job_id uuid not null, agent_name text not null, job_name text not null,
 started_at timestamptz not null, ended_at timestamptz, revision integer not null default 1 check(revision>0),
 unique(tenant_id,id), foreign key(tenant_id,agent_id) references public.agents(tenant_id,id),
 foreign key(tenant_id,job_id) references public.time_clock_jobs(tenant_id,id),
 check(isfinite(started_at) and (ended_at is null or (isfinite(ended_at) and ended_at>=started_at)))
);
create unique index time_clock_one_open_entry on public.time_clock_entries(tenant_id,agent_id) where ended_at is null;
create index time_clock_personal_history on public.time_clock_entries(tenant_id,agent_id,started_at desc,id desc);
create index time_clock_attendance_history on public.time_clock_entries(tenant_id,started_at desc,id desc);
create index time_clock_entry_job on public.time_clock_entries(tenant_id,job_id);
create table public.time_clock_breaks (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, entry_id uuid not null,
 paid boolean not null, started_at timestamptz not null, ended_at timestamptz,
 foreign key(tenant_id,entry_id) references public.time_clock_entries(tenant_id,id),
 check(isfinite(started_at) and (ended_at is null or (isfinite(ended_at) and ended_at>=started_at)))
);
create unique index time_clock_one_open_break on public.time_clock_breaks(tenant_id,entry_id) where ended_at is null;
create index time_clock_entry_breaks on public.time_clock_breaks(tenant_id,entry_id,started_at,id);
create table public.time_clock_audit (
 id bigint generated always as identity primary key, tenant_id uuid not null references public.tenants(id),
 actor_user_id uuid not null, job_id uuid not null, entry_id uuid,
 operation_id uuid not null, action text not null check(action in ('create_job','archive_job','clock_in','clock_out','break_start','break_end')),
 revision integer not null check(revision>0), occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id),
 foreign key(tenant_id,job_id) references public.time_clock_jobs(tenant_id,id),
 foreign key(tenant_id,entry_id) references public.time_clock_entries(tenant_id,id),
 unique(tenant_id,actor_user_id,operation_id)
);
create index time_clock_audit_job on public.time_clock_audit(tenant_id,job_id);
create index time_clock_audit_entry on public.time_clock_audit(tenant_id,entry_id);
create table workforce_private.time_clock_operations (
 tenant_id uuid not null references public.tenants(id), actor_user_id uuid not null,
 operation_id uuid not null, change jsonb not null, result jsonb not null,
 primary key(tenant_id,actor_user_id,operation_id),
 foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.time_clock_operations enable row level security;
revoke all on workforce_private.time_clock_operations from public,anon,authenticated;

alter table public.time_clock_jobs enable row level security;
alter table public.time_clock_entries enable row level security;
alter table public.time_clock_breaks enable row level security;
alter table public.time_clock_audit enable row level security;
revoke all on public.time_clock_jobs,public.time_clock_entries,public.time_clock_breaks,public.time_clock_audit from public,anon,authenticated;
grant select on public.time_clock_jobs,public.time_clock_entries,public.time_clock_breaks,public.time_clock_audit to authenticated;
revoke all on sequence public.time_clock_audit_id_seq from public,anon,authenticated;
create policy time_clock_entries_read on public.time_clock_entries for select to authenticated using(
 workforce_private.membership_role(tenant_id) in ('owner','admin') or
 (workforce_private.membership_role(tenant_id) is not null and exists(select 1 from public.agents a where a.tenant_id=time_clock_entries.tenant_id and a.id=time_clock_entries.agent_id and a.user_id=auth.uid() and a.status='active'))
);
create policy time_clock_jobs_read on public.time_clock_jobs for select to authenticated using(
 workforce_private.membership_role(tenant_id) is not null and
 (status='active' or exists(select 1 from public.time_clock_entries e where e.tenant_id=time_clock_jobs.tenant_id and e.job_id=time_clock_jobs.id))
);
create policy time_clock_breaks_read on public.time_clock_breaks for select to authenticated using(
 exists(select 1 from public.time_clock_entries e where e.tenant_id=time_clock_breaks.tenant_id and e.id=time_clock_breaks.entry_id)
);
create policy time_clock_audit_read on public.time_clock_audit for select to authenticated using(workforce_private.membership_role(tenant_id) in ('owner','admin'));

-- One tenant mutex serializes retry receipts, clock state and job archives.
-- Current authorization is checked BEFORE returning a previous receipt.
create function workforce_private.save_time_clock(target_tenant uuid, operation_id uuid, change jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; op text:=change->>'action'; agent public.agents%rowtype;
 job public.time_clock_jobs%rowtype; entry public.time_clock_entries%rowtype;
 previous workforce_private.time_clock_operations%rowtype; instant timestamptz; result jsonb;
 permitted text[]; expected integer;
begin
 if actor is null then raise exception using errcode='42501',message='Sign in to continue'; end if;
 perform 1 from public.tenants where id=target_tenant and status='active' for update;
 if not found then raise exception using errcode='42501',message='Company access unavailable'; end if;
 perform 1 from public.tenant_memberships where tenant_id=target_tenant and user_id=actor and status='active' for share;
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null then raise exception using errcode='42501',message='Company access unavailable'; end if;
 if operation_id is null or jsonb_typeof(change) is distinct from 'object' or octet_length(change::text)>4096 or op is null or op not in ('create_job','archive_job','clock_in','clock_out','break_start','break_end') then raise exception using errcode='22023',message='Invalid clock action'; end if;
 if op in ('create_job','archive_job') then
  if role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins manage jobs'; end if;
 else
  select * into agent from public.agents where tenant_id=target_tenant and user_id=actor and status='active' for share;
  if not found then raise exception using errcode='42501',message='An active linked agent is required'; end if;
 end if;
 select * into previous from workforce_private.time_clock_operations r where r.tenant_id=target_tenant and r.actor_user_id=actor and r.operation_id=save_time_clock.operation_id;
 if found then
  if op not in ('create_job','archive_job') then
   perform 1 from public.time_clock_entries e where e.tenant_id=target_tenant and e.id=(previous.result->>'entryId')::uuid and e.agent_id=agent.id;
   if not found then raise exception using errcode='42501',message='This clock receipt belongs to an earlier linked agent'; end if;
  end if;
  if previous.change is distinct from change then raise exception using errcode='40001',message='This operation was used for another action'; end if;
  return previous.result;
 end if;
 permitted:=case op when 'create_job' then array['action','name'] when 'archive_job' then array['action','jobId','revision'] when 'clock_in' then array['action','jobId'] when 'break_start' then array['action','entryId','revision','paid'] else array['action','entryId','revision'] end;
 if exists(select 1 from jsonb_object_keys(change) k where k<>all(permitted)) then raise exception using errcode='22023',message='Unknown clock field'; end if;
 if op in ('archive_job','clock_out','break_start','break_end') then
  if jsonb_typeof(change->'revision') is distinct from 'number' or (change->>'revision') !~ '^[1-9][0-9]{0,9}$' then raise exception using errcode='22023',message='A current revision is required'; end if;
  expected:=(change->>'revision')::integer;
 end if;
 if op='create_job' then
  if jsonb_typeof(change->'name') is distinct from 'string' or length(btrim(change->>'name')) not between 1 and 100 then raise exception using errcode='22023',message='Enter a job name'; end if;
  if (select count(*) from public.time_clock_jobs where tenant_id=target_tenant and status='active')>=200 then raise exception using errcode='22023',message='Archive unused jobs before adding more'; end if;
  insert into public.time_clock_jobs(tenant_id,name) values(target_tenant,btrim(change->>'name')) returning * into job;
 elsif op in ('archive_job','clock_in') then
  if jsonb_typeof(change->'jobId') is distinct from 'string' then raise exception using errcode='22023',message='Choose a job'; end if;
  select * into job from public.time_clock_jobs where tenant_id=target_tenant and id=(change->>'jobId')::uuid for update;
  if not found then raise exception using errcode='P0002',message='Job unavailable'; end if;
  if job.status<>'active' then raise exception using errcode='40001',message='This job is archived'; end if;
  if op='archive_job' then
   if expected<>job.revision then raise exception using errcode='40001',message='Job changed. Reload before continuing'; end if;
   update public.time_clock_jobs set status='archived',revision=revision+1 where id=job.id returning * into job;
  else
   if exists(select 1 from public.time_clock_entries where tenant_id=target_tenant and agent_id=agent.id and ended_at is null) then raise exception using errcode='40001',message='Already clocked in. Reload before continuing'; end if;
   instant:=clock_timestamp();
   insert into public.time_clock_entries(tenant_id,agent_id,job_id,agent_name,job_name,started_at) values(target_tenant,agent.id,job.id,agent.first_name||' '||agent.last_name,job.name,instant) returning * into entry;
  end if;
 else
  if jsonb_typeof(change->'entryId') is distinct from 'string' then raise exception using errcode='22023',message='Choose your current entry'; end if;
  select * into entry from public.time_clock_entries where tenant_id=target_tenant and id=(change->>'entryId')::uuid and agent_id=agent.id for update;
  if not found then raise exception using errcode='P0002',message='Clock entry unavailable'; end if;
  if entry.ended_at is not null or expected<>entry.revision then raise exception using errcode='40001',message='Clock entry changed. Reload before continuing'; end if;
  -- Ending a retained entry/break does not require its job to remain active.
  select * into job from public.time_clock_jobs where tenant_id=target_tenant and id=entry.job_id;
  select greatest(clock_timestamp(),entry.started_at,coalesce(max(coalesce(ended_at,started_at)),entry.started_at)) into instant from public.time_clock_breaks where tenant_id=target_tenant and entry_id=entry.id;
  if op='break_start' then
   if jsonb_typeof(change->'paid') is distinct from 'boolean' then raise exception using errcode='22023',message='Choose paid or unpaid break'; end if;
   if exists(select 1 from public.time_clock_breaks where tenant_id=target_tenant and entry_id=entry.id and ended_at is null) then raise exception using errcode='40001',message='A break is already open'; end if;
   if (select count(*) from public.time_clock_breaks where tenant_id=target_tenant and entry_id=entry.id)>=100 then raise exception using errcode='22023',message='Break limit reached for this entry'; end if;
   insert into public.time_clock_breaks(tenant_id,entry_id,paid,started_at) values(target_tenant,entry.id,(change->>'paid')::boolean,instant);
  elsif op='break_end' then
   update public.time_clock_breaks set ended_at=greatest(instant,started_at) where tenant_id=target_tenant and entry_id=entry.id and ended_at is null;
   if not found then raise exception using errcode='40001',message='No break is open'; end if;
  else
   -- Clock-out closes the current break at exactly the same server instant.
   select greatest(instant,coalesce(max(started_at),instant)) into instant from public.time_clock_breaks where tenant_id=target_tenant and entry_id=entry.id;
   update public.time_clock_breaks set ended_at=instant where tenant_id=target_tenant and entry_id=entry.id and ended_at is null;
  end if;
  update public.time_clock_entries set ended_at=case when op='clock_out' then instant else null end,revision=revision+1 where id=entry.id returning * into entry;
 end if;
 result:=jsonb_strip_nulls(jsonb_build_object('operationId',operation_id,'action',op,'jobId',job.id,'entryId',entry.id,'revision',case when op in ('create_job','archive_job') then job.revision else entry.revision end));
 insert into public.time_clock_audit(tenant_id,actor_user_id,job_id,entry_id,operation_id,action,revision) values(target_tenant,actor,job.id,entry.id,operation_id,op,(result->>'revision')::integer);
 insert into workforce_private.time_clock_operations values(target_tenant,actor,operation_id,change,result);
 return result;
end;$$;
revoke all on function workforce_private.save_time_clock(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function workforce_private.save_time_clock(uuid,uuid,jsonb) to authenticated;
create function public.save_time_clock(target_tenant uuid, operation_id uuid, change jsonb) returns jsonb
language sql security invoker set search_path='' as $$select workforce_private.save_time_clock(target_tenant,operation_id,change)$$;
revoke all on function public.save_time_clock(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_time_clock(uuid,uuid,jsonb) to authenticated;

create function workforce_private.time_clock_entry_json(entry_id uuid, as_of timestamptz) returns jsonb
language sql stable security invoker set search_path='' as $$
 select to_jsonb(e)||jsonb_build_object(
  'breaks',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'started_at',b.started_at,'ended_at',b.ended_at,'paid',b.paid) order by b.started_at,b.id) from public.time_clock_breaks b where b.tenant_id=e.tenant_id and b.entry_id=e.id),'[]'::jsonb),
  'elapsed_seconds',greatest(0,extract(epoch from (coalesce(e.ended_at,as_of)-e.started_at))),
  'unpaid_break_seconds',coalesce((select sum(greatest(0,extract(epoch from (coalesce(b.ended_at,as_of)-b.started_at)))) from public.time_clock_breaks b where b.tenant_id=e.tenant_id and b.entry_id=e.id and not b.paid),0),
  'paid_seconds',greatest(0,extract(epoch from (coalesce(e.ended_at,as_of)-e.started_at))-coalesce((select sum(greatest(0,extract(epoch from (coalesce(b.ended_at,as_of)-b.started_at)))) from public.time_clock_breaks b where b.tenant_id=e.tenant_id and b.entry_id=e.id and not b.paid),0))
 ) from public.time_clock_entries e where e.id=entry_id
$$;
revoke all on function workforce_private.time_clock_entry_json(uuid,timestamptz) from public,anon,authenticated;
grant execute on function workforce_private.time_clock_entry_json(uuid,timestamptz) to authenticated;

-- First instant of a company calendar date, including the first midnight of
-- a rollback and the next available day when a calendar date is skipped.
create function workforce_private.time_clock_day_start(calendar_day date, time_zone text) returns timestamptz
language plpgsql stable security invoker set search_path='' as $$
declare low_us bigint; high_us bigint; middle_us bigint; instant timestamptz;
begin
 if calendar_day is null or not isfinite(calendar_day) then raise exception using errcode='22023',message='Choose a finite company date'; end if;
 low_us:=(extract(epoch from (calendar_day::timestamp at time zone 'UTC'))*1000000)::bigint-259200000000;
 high_us:=low_us+518400000000;
 while low_us<high_us loop
  middle_us:=low_us+(high_us-low_us)/2;
  instant:=timestamptz 'epoch'+(middle_us::text||' microseconds')::interval;
  if (instant at time zone time_zone)::date<calendar_day then low_us:=middle_us+1;else high_us:=middle_us;end if;
 end loop;
 return timestamptz 'epoch'+(low_us::text||' microseconds')::interval;
end;$$;
revoke all on function workforce_private.time_clock_day_start(date,text) from public,anon,authenticated;
grant execute on function workforce_private.time_clock_day_start(date,text) to authenticated;

create function public.read_time_clock(target_tenant uuid, view_mode text default 'status', page_limit integer default 50, start_date date default null, end_date date default null, after_entry jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; company public.tenants%rowtype; agent public.agents%rowtype;
 instant timestamptz:=statement_timestamp(); current_entry public.time_clock_entries%rowtype;
 jobs jsonb; entries jsonb; next_cursor jsonb; cursor_time timestamptz; cursor_id uuid; today date;
 ids uuid[]; lower_bound timestamptz; upper_bound timestamptz;
begin
 role_name:=workforce_private.membership_role(target_tenant);
 if actor is null or role_name is null then raise exception using errcode='42501',message='Company access unavailable'; end if;
 select * into company from public.tenants where id=target_tenant and status='active';
 if not found then raise exception using errcode='42501',message='Company access unavailable'; end if;
 if view_mode is null or view_mode not in ('status','attendance','timesheets') or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid clock view'; end if;
 if view_mode='attendance' and role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins view attendance'; end if;
 if start_date is not null and (not isfinite(start_date) or start_date not between date '0001-01-01' and date '9999-12-31') or end_date is not null and (not isfinite(end_date) or end_date not between date '0001-01-01' and date '9999-12-31') or start_date>end_date then raise exception using errcode='22023',message='Choose valid calendar dates'; end if;
 select * into agent from public.agents where tenant_id=target_tenant and user_id=actor and status='active';
 if view_mode='status' then
  if start_date is not null or end_date is not null or after_entry is not null then raise exception using errcode='22023',message='Status does not accept history filters'; end if;
  select * into current_entry from public.time_clock_entries where tenant_id=target_tenant and agent_id=agent.id and ended_at is null;
  select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'name',j.name,'status',j.status,'revision',j.revision) order by j.name,j.id),'[]'::jsonb) into jobs from public.time_clock_jobs j where j.tenant_id=target_tenant and (j.status='active' or j.id=current_entry.job_id);
  return jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'time_zone',company.time_zone),'role',role_name,'actorId',actor,'agent',case when agent.id is null then null else jsonb_build_object('id',agent.id,'name',agent.first_name||' '||agent.last_name) end,'jobs',jobs,'entry',workforce_private.time_clock_entry_json(current_entry.id,instant),'serverTime',instant,'canManageJobs',role_name in ('owner','admin'),'canViewAttendance',role_name in ('owner','admin'));
 end if;
 today:=(instant at time zone company.time_zone)::date;
 if view_mode='attendance' and (start_date is not null or end_date is not null) then raise exception using errcode='22023',message='Attendance uses the current company date'; end if;
 if view_mode='attendance' then
  lower_bound:=workforce_private.time_clock_day_start(today,company.time_zone);
  upper_bound:=workforce_private.time_clock_day_start(today+1,company.time_zone);
 else
  if start_date is not null then lower_bound:=workforce_private.time_clock_day_start(start_date,company.time_zone);end if;
  if end_date is not null then upper_bound:=workforce_private.time_clock_day_start(end_date+1,company.time_zone);end if;
 end if;
 if after_entry is not null then
  if jsonb_typeof(after_entry) is distinct from 'object' or octet_length(after_entry::text)>2048 or (after_entry->>'tenantId') is distinct from target_tenant::text or (after_entry->>'actorId') is distinct from actor::text or (after_entry->>'mode') is distinct from view_mode or (after_entry->>'timeZone') is distinct from company.time_zone or (after_entry->>'startDate') is distinct from start_date::text or (after_entry->>'endDate') is distinct from end_date::text or (view_mode='attendance' and (after_entry->>'today') is distinct from today::text) then raise exception using errcode='22023',message='Clock filters changed. Reload from the latest entries'; end if;
  cursor_time:=(after_entry->>'startedAt')::timestamptz; cursor_id:=(after_entry->>'entryId')::uuid;
  if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then raise exception using errcode='22023',message='Invalid clock cursor'; end if;
 end if;
 select array_agg(q.id order by q.started_at desc,q.id desc) into ids from (
  select e.id,e.started_at from public.time_clock_entries e where e.tenant_id=target_tenant
   and ((view_mode='timesheets' and e.agent_id=agent.id and e.ended_at is not null
     and (lower_bound is null or e.started_at>=lower_bound)
     and (upper_bound is null or e.started_at<upper_bound))
    or (view_mode='attendance' and (e.ended_at is null or (e.started_at<upper_bound and e.ended_at>=lower_bound))))
   and (after_entry is null or (e.started_at,e.id)<(cursor_time,cursor_id))
  order by e.started_at desc,e.id desc limit page_limit+1
 ) q;
 select coalesce(jsonb_agg(workforce_private.time_clock_entry_json(u.id,instant) order by u.ordinality),'[]'::jsonb) into entries from unnest(ids[1:page_limit]) with ordinality u(id,ordinality);
 if cardinality(ids)>page_limit then
  select jsonb_build_object('tenantId',target_tenant,'actorId',actor,'mode',view_mode,'timeZone',company.time_zone,'startDate',start_date,'endDate',end_date,'today',case when view_mode='attendance' then today else null end,'startedAt',e.started_at,'entryId',e.id) into next_cursor from public.time_clock_entries e where e.id=ids[page_limit];
 end if;
 return jsonb_build_object('entries',entries,'nextCursor',next_cursor,'serverTime',instant,'timeZone',company.time_zone);
end;$$;
revoke all on function public.read_time_clock(uuid,text,integer,date,date,jsonb) from public,anon,authenticated;
grant execute on function public.read_time_clock(uuid,text,integer,date,date,jsonb) to authenticated;
commit;
