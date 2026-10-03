begin;

create table public.agent_fields (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  key text not null check (key ~ '^[a-z][a-z0-9_]{0,39}$'),
  label text not null check (length(btrim(label)) between 1 and 100),
  required boolean not null default false,
  position integer not null default 0,
  primary key (tenant_id, key)
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id),
  user_id uuid,
  first_name text not null check (length(btrim(first_name)) between 1 and 100),
  last_name text not null check (length(btrim(last_name)) between 1 and 100),
  phone text not null check (phone ~ '^\+[1-9][0-9]{7,14}$'),
  title text not null default '' check (length(title) <= 100),
  team text not null default '' check (length(team) <= 100),
  employment_start_date date,
  custom_fields jsonb not null default '{}' check (jsonb_typeof(custom_fields) = 'object'),
  status text not null default 'active' check (status in ('active', 'archived')),
  revision integer not null default 1 check (revision > 0),
  created_by uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  unique (tenant_id, phone),
  unique (tenant_id, user_id),
  foreign key (tenant_id, user_id) references public.tenant_memberships(tenant_id, user_id),
  foreign key (tenant_id, created_by) references public.tenant_memberships(tenant_id, user_id)
);
create index agents_tenant_status_name_idx on public.agents(tenant_id, status, last_name, first_name);

create table public.agent_audit (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id),
  agent_id uuid not null,
  actor_user_id uuid references auth.users(id) on delete set null,
  actor_name text not null,
  action text not null check (action in ('created', 'updated', 'archived', 'restored')),
  revision integer not null,
  occurred_at timestamptz not null default now(),
  foreign key (tenant_id, agent_id) references public.agents(tenant_id, id)
);
create index agent_audit_tenant_time_idx on public.agent_audit(tenant_id, occurred_at desc);

alter table public.agent_fields enable row level security;
alter table public.agents enable row level security;
alter table public.agent_audit enable row level security;
revoke all on public.agent_fields, public.agents, public.agent_audit from public, anon, authenticated;
grant select on public.agent_fields, public.agents, public.agent_audit to authenticated;
grant select, insert, update, delete on public.agent_fields, public.agents, public.agent_audit to service_role;
grant usage, select on sequence public.agent_audit_id_seq to service_role;

create policy fields_read on public.agent_fields for select to authenticated
  using (workforce_private.membership_role(tenant_id) is not null);
create policy agents_read on public.agents for select to authenticated
  using (workforce_private.membership_role(tenant_id) in ('owner','admin','manager')
    or (user_id = (select auth.uid()) and status='active' and workforce_private.membership_role(tenant_id)='employee'));
create policy audit_read on public.agent_audit for select to authenticated
  using (workforce_private.membership_role(tenant_id) in ('owner','admin'));

-- All record mutations and their audit events are one transaction. Locks keep
-- actor/company suspension from racing an authorized mutation. This never
-- changes Auth accounts or company ownership and never sends invites.
-- Archive suspends linked company membership; restore returns ordinary access.
create function workforce_private.save_agents(target_tenant uuid, changes jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid(); actor_name text; actor_role text;
  item jsonb; field record; agent public.agents%rowtype; existing public.agents%rowtype;
  record_id uuid; expected_revision integer; event text; target_role text; saved jsonb := '[]';
begin
  if actor is null or not exists (select 1 from auth.users where id=actor and email_confirmed_at is not null and is_anonymous is not true) then
    raise exception using errcode='42501', message='Sign in to continue';
  end if;
  perform 1 from public.tenants where id=target_tenant and status='active' for share;
  if not found then raise exception using errcode='42501', message='Company access unavailable'; end if;
  select display_name, role into actor_name, actor_role from public.tenant_memberships
    where tenant_id=target_tenant and user_id=actor and status='active' for share;
  if actor_role is null or actor_role not in ('owner','admin') then
    raise exception using errcode='42501', message='Only owners and admins can manage agents';
  end if;
  if changes is null or jsonb_typeof(changes) <> 'array' or jsonb_array_length(changes) not between 1 and 25 or octet_length(changes::text)>64000 then
    raise exception using errcode='22023', message='Add between one and 25 agents';
  end if;
  perform 1 from public.agent_fields where tenant_id=target_tenant for share;
  for item in select value from jsonb_array_elements(changes) loop
    if jsonb_typeof(item)<>'object' or exists (select 1 from jsonb_object_keys(item) k where k not in ('action','id','revision','first_name','last_name','phone','title','team','employment_start_date','custom_fields')) then
      raise exception using errcode='22023', message='Invalid agent fields';
    end if;
    if item->>'action' is null or item->>'action' not in ('create','update','archive','restore') then
      raise exception using errcode='22023', message='Invalid action';
    end if;
    if item->>'action'='create' then
      if item ? 'id' or item ? 'revision' then raise exception using errcode='22023', message='New agent identity is server assigned'; end if;
      record_id := gen_random_uuid(); event := 'created';
    else
      record_id := (item->>'id')::uuid; expected_revision := (item->>'revision')::integer;
      select * into existing from public.agents where id=record_id and tenant_id=target_tenant for update;
      if not found then raise exception using errcode='P0002', message='Agent not found'; end if;
      if expected_revision is null or expected_revision<>existing.revision then
        raise exception using errcode='40001', message='This agent changed. Reload before saving';
      end if;
      event := case item->>'action' when 'update' then 'updated' when 'archive' then 'archived' else 'restored' end;
    end if;
    if item->>'action' in ('create','update') then
      if jsonb_typeof(item->'first_name') is distinct from 'string' or jsonb_typeof(item->'last_name') is distinct from 'string' or jsonb_typeof(item->'phone') is distinct from 'string' then raise exception using errcode='22023', message='Enter a first name, last name and mobile number'; end if;
      if (item ? 'title' and jsonb_typeof(item->'title') <> 'string') or (item ? 'team' and jsonb_typeof(item->'team') <> 'string') then raise exception using errcode='22023', message='Enter valid title and team'; end if;
      if item->>'action'='update' and existing.status<>'active' then raise exception using errcode='22023', message='Restore the agent before editing'; end if;
      if jsonb_typeof(item->'custom_fields') is distinct from 'object' then raise exception using errcode='22023', message='Enter valid custom fields'; end if;
      if exists (select 1 from jsonb_each(item->'custom_fields') kv where jsonb_typeof(kv.value)<>'string' or length(kv.value#>>'{}')>500 or not exists (select 1 from public.agent_fields f where f.tenant_id=target_tenant and f.key=kv.key)) then
        raise exception using errcode='22023', message='Unknown or invalid custom field';
      end if;
      for field in select key, label from public.agent_fields where tenant_id=target_tenant and required loop
        if coalesce(length(btrim(item->'custom_fields'->>field.key)),0)=0 then raise exception using errcode='22023', message='Complete the required custom fields'; end if;
      end loop;
      if item->>'action'='create' then
        insert into public.agents(id,tenant_id,first_name,last_name,phone,title,team,employment_start_date,custom_fields,created_by)
          values(record_id,target_tenant,btrim(item->>'first_name'),btrim(item->>'last_name'),item->>'phone',coalesce(item->>'title',''),coalesce(item->>'team',''),nullif(item->>'employment_start_date','')::date,item->'custom_fields',actor) returning * into agent;
      else
        update public.agents set first_name=btrim(item->>'first_name'),last_name=btrim(item->>'last_name'),phone=item->>'phone',title=coalesce(item->>'title',''),team=coalesce(item->>'team',''),employment_start_date=nullif(item->>'employment_start_date','')::date,custom_fields=item->'custom_fields',revision=revision+1,updated_at=now()
          where id=record_id and tenant_id=target_tenant returning * into agent;
      end if;
    else
      if (event='archived' and existing.status<>'active') or (event='restored' and existing.status<>'archived') then raise exception using errcode='40001', message='Agent status changed. Reload before continuing'; end if;
      if existing.user_id=actor then raise exception using errcode='42501', message='You cannot archive or restore yourself'; end if;
      if existing.user_id is not null then
        select role into target_role from public.tenant_memberships where tenant_id=target_tenant and user_id=existing.user_id for update;
        -- Owner transfer is not enabled in this slice. Protect every owner,
        -- including the last one, rather than allowing orphaned companies.
        if target_role='owner' then raise exception using errcode='42501', message='Company owners cannot be archived'; end if;
        update public.tenant_memberships set status=case event when 'archived' then 'suspended' else 'active' end,
          role=case event when 'restored' then 'employee' else role end
          where tenant_id=target_tenant and user_id=existing.user_id;
      end if;
      update public.agents set status=case event when 'archived' then 'archived' else 'active' end,revision=revision+1,updated_at=now()
        where id=record_id and tenant_id=target_tenant returning * into agent;
    end if;
    insert into public.agent_audit(tenant_id,agent_id,actor_user_id,actor_name,action,revision)
      values(target_tenant,record_id,actor,actor_name,event,agent.revision);
    saved := saved || jsonb_build_array(jsonb_build_object('id',agent.id,'revision',agent.revision));
  end loop;
  return saved;
end;
$$;
revoke all on function workforce_private.save_agents(uuid,jsonb) from public, anon, authenticated;
grant execute on function workforce_private.save_agents(uuid,jsonb) to authenticated;
create function public.save_agents(target_tenant uuid, changes jsonb) returns jsonb
language sql security invoker set search_path = '' as $$
  select workforce_private.save_agents(target_tenant, changes)
$$;
revoke all on function public.save_agents(uuid,jsonb) from public, anon, authenticated;
grant execute on function public.save_agents(uuid,jsonb) to authenticated;

commit;
