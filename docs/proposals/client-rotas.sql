begin;
-- Proposed module migration. Parent assigns its version after independent review.
create table public.rota_schedules (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 name text not null check (length(btrim(name)) between 1 and 100),
 time_zone text not null, status text not null default 'active' check (status in ('active','archived')),
 revision integer not null default 1 check (revision>0), unique(tenant_id,id)
);
create trigger rota_time_zone before insert or update of time_zone on public.rota_schedules for each row execute function workforce_private.check_time_zone();
create table public.rota_admins (
 tenant_id uuid not null, schedule_id uuid not null, user_id uuid not null,
 primary key(tenant_id,schedule_id,user_id),
 foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id),
 foreign key(tenant_id,user_id) references public.tenant_memberships(tenant_id,user_id)
);
create table public.rota_agents (
 tenant_id uuid not null, schedule_id uuid not null, agent_id uuid not null,
 primary key(tenant_id,schedule_id,agent_id),
 foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id),
 foreign key(tenant_id,agent_id) references public.agents(tenant_id,id)
);
create table public.rota_jobs (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, schedule_id uuid not null,
 name text not null check (length(btrim(name)) between 1 and 100),
 color text not null check(color ~ '^#[0-9a-fA-F]{6}$'),
 unique(tenant_id,schedule_id,id),
 foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id)
);
create table public.rota_shifts (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, schedule_id uuid not null,
 agent_id uuid not null, job_id uuid not null, starts_at timestamptz not null, ends_at timestamptz not null,
 title text not null default '' check(length(title)<=100),
 status text not null default 'draft' check(status in ('draft','published')),
 published_at timestamptz, revision integer not null default 1 check(revision>0),
 foreign key(tenant_id,schedule_id,agent_id) references public.rota_agents(tenant_id,schedule_id,agent_id),
 foreign key(tenant_id,schedule_id,job_id) references public.rota_jobs(tenant_id,schedule_id,id),
 check(isfinite(starts_at) and isfinite(ends_at) and ends_at>starts_at and ends_at-starts_at<=interval '24 hours'),
 check((status='draft' and published_at is null) or (status='published' and published_at is not null))
);
create index rota_shift_agent_time on public.rota_shifts(tenant_id,agent_id,starts_at,ends_at);
create index rota_shift_schedule_time on public.rota_shifts(tenant_id,schedule_id,starts_at);
create table public.rota_audit (
 id bigint generated always as identity primary key, tenant_id uuid not null, schedule_id uuid not null,
 actor_user_id uuid not null, action text not null check(action in ('create_schedule','add_job','save_shift','publish','archive','restore')),
 revision integer not null, occurred_at timestamptz not null default now(),
 foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id),
 foreign key(tenant_id,actor_user_id) references public.tenant_memberships(tenant_id,user_id)
);

create function workforce_private.rota_manage(t uuid,s uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce(workforce_private.membership_role(t) in ('owner','admin') or
 (workforce_private.membership_role(t)='manager' and exists(select 1 from public.rota_admins where tenant_id=t and schedule_id=s and user_id=auth.uid())),false)
$$;
create function workforce_private.rota_access(t uuid,s uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select workforce_private.membership_role(t) is not null and
 (workforce_private.rota_manage(t,s) or exists(select 1 from public.rota_agents ra join public.agents a on a.tenant_id=ra.tenant_id and a.id=ra.agent_id
 where ra.tenant_id=t and ra.schedule_id=s and a.user_id=auth.uid() and a.status='active'))
$$;
revoke all on function workforce_private.rota_manage(uuid,uuid), workforce_private.rota_access(uuid,uuid) from public,anon,authenticated;
grant execute on function workforce_private.rota_manage(uuid,uuid), workforce_private.rota_access(uuid,uuid) to authenticated;

alter table public.rota_schedules enable row level security;
alter table public.rota_admins enable row level security;
alter table public.rota_agents enable row level security;
alter table public.rota_jobs enable row level security;
alter table public.rota_shifts enable row level security;
alter table public.rota_audit enable row level security;
revoke all on public.rota_schedules,public.rota_admins,public.rota_agents,public.rota_jobs,public.rota_shifts,public.rota_audit from public,anon,authenticated;
grant select on public.rota_schedules,public.rota_admins,public.rota_agents,public.rota_jobs,public.rota_shifts,public.rota_audit to authenticated;
create policy schedules_read on public.rota_schedules for select to authenticated using(workforce_private.rota_access(tenant_id,id));
create policy admins_read on public.rota_admins for select to authenticated using(workforce_private.rota_manage(tenant_id,schedule_id));
create policy assigned_read on public.rota_agents for select to authenticated using(workforce_private.rota_manage(tenant_id,schedule_id) or (workforce_private.rota_access(tenant_id,schedule_id) and exists(select 1 from public.agents a where a.tenant_id=rota_agents.tenant_id and a.id=rota_agents.agent_id and a.user_id=auth.uid() and a.status='active')));
create policy jobs_read on public.rota_jobs for select to authenticated using(workforce_private.rota_access(tenant_id,schedule_id));
create policy shifts_read on public.rota_shifts for select to authenticated using(workforce_private.rota_manage(tenant_id,schedule_id) or
 (status='published' and workforce_private.rota_access(tenant_id,schedule_id) and exists(select 1 from public.agents a where a.tenant_id=rota_shifts.tenant_id and a.id=rota_shifts.agent_id and a.user_id=auth.uid() and a.status='active')));
create policy rota_audit_read on public.rota_audit for select to authenticated using(workforce_private.rota_manage(tenant_id,schedule_id));

-- All writes pass through one bounded, authenticated operation. Company lock
-- serializes overlap checks across schedules and prevents suspension races.
create function workforce_private.save_rota(target_tenant uuid, change jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; op text:=change->>'action'; s public.rota_schedules%rowtype;
 sid uuid; aid uuid; jid uuid; shift public.rota_shifts%rowtype; start_time timestamptz; end_time timestamptz;
 ids uuid[]; admins uuid[]; has_overlap boolean; new_revision integer;
begin
 if actor is null then raise exception using errcode='42501',message='Sign in'; end if;
 perform 1 from public.tenants where id=target_tenant and status='active' for update;
 if not found then raise exception using errcode='42501',message='Company unavailable'; end if;
 perform 1 from public.tenant_memberships where tenant_id=target_tenant and user_id=actor and status='active' for share;
 if not found then raise exception using errcode='42501',message='Company access denied'; end if;
 role_name:=workforce_private.membership_role(target_tenant);
 if role_name is null then raise exception using errcode='42501',message='Company access denied'; end if;
 if jsonb_typeof(change) is distinct from 'object' or octet_length(change::text)>16000 or op is null or op not in ('create_schedule','add_job','save_shift','publish','archive','restore') then
 raise exception using errcode='22023',message='Invalid scheduling action'; end if;
 if exists(select 1 from jsonb_object_keys(change) k where k not in ('action','schedule_id','revision','name','time_zone','agent_ids','admin_ids','color','id','agent_id','job_id','starts_at','ends_at','title','allow_overlap')) then
 raise exception using errcode='22023',message='Unknown scheduling field'; end if;
 if op='create_schedule' then
  if role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins create schedules'; end if;
  if jsonb_typeof(change->'agent_ids') is distinct from 'array' or jsonb_array_length(change->'agent_ids') not between 1 and 1000 or jsonb_typeof(change->'admin_ids') is distinct from 'array' or jsonb_array_length(change->'admin_ids')>100 then raise exception using errcode='22023',message='Choose users and administrators'; end if;
  select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(change->'agent_ids');
  select array_agg(distinct value::uuid) into admins from jsonb_array_elements_text(change->'admin_ids');
  perform 1 from public.agents where tenant_id=target_tenant and id=any(ids) and status='active' for share;
  if (select count(*) from public.agents where tenant_id=target_tenant and id=any(ids) and status='active')<>cardinality(ids) then raise exception using errcode='22023',message='Users must be active in this company'; end if;
  perform 1 from public.tenant_memberships where tenant_id=target_tenant and user_id=any(admins) and status='active' for share;
  if (select count(*) from public.tenant_memberships where tenant_id=target_tenant and user_id=any(admins) and status='active' and role in ('owner','admin','manager'))<>coalesce(cardinality(admins),0) then raise exception using errcode='22023',message='Invalid schedule administrator'; end if;
  insert into public.rota_schedules(tenant_id,name,time_zone) values(target_tenant,btrim(change->>'name'),change->>'time_zone') returning * into s;
  sid:=s.id;
  insert into public.rota_agents select target_tenant,sid,unnest(ids);
  insert into public.rota_admins select target_tenant,sid,unnest(admins);
 else
  sid:=(change->>'schedule_id')::uuid;
  select * into s from public.rota_schedules where tenant_id=target_tenant and id=sid for update;
  if not found or not workforce_private.rota_manage(target_tenant,sid) then raise exception using errcode='42501',message='Schedule permission denied'; end if;
  -- Lock a delegated grant and membership so revocation cannot race this write.
  perform 1 from public.rota_admins where tenant_id=target_tenant and schedule_id=sid and user_id=actor for share;
  if role_name='manager' and not found then raise exception using errcode='42501',message='Schedule administrator permission revoked'; end if;
  if (change->>'revision')::integer is distinct from s.revision then raise exception using errcode='40001',message='Schedule changed. Reload before saving'; end if;
  if s.status='archived' and op<>'restore' then raise exception using errcode='22023',message='Restore the schedule first'; end if;
  if op='restore' and s.status<>'archived' then raise exception using errcode='22023',message='Schedule is already active'; end if;
  if op='add_job' then
   insert into public.rota_jobs(tenant_id,schedule_id,name,color) values(target_tenant,sid,btrim(change->>'name'),change->>'color');
  elsif op='save_shift' then
   aid:=(change->>'agent_id')::uuid; jid:=(change->>'job_id')::uuid;
   perform 1 from public.agents where tenant_id=target_tenant and id=aid and status='active' for share;
   if not found then raise exception using errcode='22023',message='Choose an active user'; end if;
   perform 1 from public.tenant_memberships m join public.agents a on a.tenant_id=m.tenant_id and a.user_id=m.user_id where a.tenant_id=target_tenant and a.id=aid for share of m;
   if exists(select 1 from public.agents a join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.user_id where a.tenant_id=target_tenant and a.id=aid and m.status<>'active') then raise exception using errcode='22023',message='User access suspended'; end if;
   if coalesce(change->>'starts_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' or coalesce(change->>'ends_at','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$' then raise exception using errcode='22023',message='Explicit timestamp offsets required'; end if;
   start_time:=(change->>'starts_at')::timestamptz; end_time:=(change->>'ends_at')::timestamptz;
   if change->>'id' is not null then
    select * into shift from public.rota_shifts where tenant_id=target_tenant and schedule_id=sid and id=(change->>'id')::uuid for update;
    if not found then raise exception using errcode='P0002',message='Shift not found'; end if;
    if shift.status<>'draft' then raise exception using errcode='22023',message='Published shift editing is not available yet'; end if;
   end if;
   select exists(select 1 from public.rota_shifts r where r.tenant_id=target_tenant and r.agent_id=aid and r.id is distinct from shift.id and r.starts_at<end_time and r.ends_at>start_time
    and exists(select 1 from public.rota_schedules rs where rs.tenant_id=r.tenant_id and rs.id=r.schedule_id and rs.status='active')) into has_overlap;
   if has_overlap and coalesce((change->>'allow_overlap')::boolean,false) is not true then raise exception using errcode='P0001',message='This user has an overlapping shift. Review and explicitly allow overlap'; end if;
   if shift.id is null then
    insert into public.rota_shifts(tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title) values(target_tenant,sid,aid,jid,start_time,end_time,coalesce(change->>'title',''));
   else
    update public.rota_shifts set agent_id=aid,job_id=jid,starts_at=start_time,ends_at=end_time,title=coalesce(change->>'title',''),revision=revision+1 where id=shift.id;
   end if;
  elsif op='publish' then
   perform 1 from public.agents a where a.tenant_id=target_tenant and exists(select 1 from public.rota_shifts r where r.tenant_id=target_tenant and r.schedule_id=sid and r.status='draft' and r.agent_id=a.id) for share;
   perform 1 from public.tenant_memberships m where m.tenant_id=target_tenant and exists(select 1 from public.rota_shifts r join public.agents a on a.tenant_id=r.tenant_id and a.id=r.agent_id where r.tenant_id=target_tenant and r.schedule_id=sid and r.status='draft' and a.user_id=m.user_id) for share;
   if exists(select 1 from public.rota_shifts r join public.agents a on a.tenant_id=r.tenant_id and a.id=r.agent_id left join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.user_id where r.tenant_id=target_tenant and r.schedule_id=sid and r.status='draft' and (a.status<>'active' or (a.user_id is not null and m.status<>'active'))) then raise exception using errcode='22023',message='Draft contains an inactive user'; end if;
   update public.rota_shifts set status='published',published_at=now(),revision=revision+1 where tenant_id=target_tenant and schedule_id=sid and status='draft';
   if not found then raise exception using errcode='22023',message='No drafts to publish'; end if;
  elsif op in ('archive','restore') then
   if role_name not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins archive schedules'; end if;
   update public.rota_schedules set status=case op when 'archive' then 'archived' else 'active' end where id=sid;
  end if;
  update public.rota_schedules set revision=revision+1 where id=sid returning revision into new_revision;
 end if;
 insert into public.rota_audit(tenant_id,schedule_id,actor_user_id,action,revision) values(target_tenant,sid,actor,op,coalesce(new_revision,1));
 return jsonb_build_object('schedule_id',sid,'revision',coalesce(new_revision,1));
end;
$$;
revoke all on function workforce_private.save_rota(uuid,jsonb) from public,anon,authenticated;
grant execute on function workforce_private.save_rota(uuid,jsonb) to authenticated;
create function public.save_rota(target_tenant uuid, change jsonb) returns jsonb language sql security invoker set search_path='' as $$select workforce_private.save_rota(target_tenant,change)$$;
revoke all on function public.save_rota(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.save_rota(uuid,jsonb) to authenticated;
commit;
