begin;

-- Fresh-project foundation only. No existing application data is imported.
-- Deliberately fail on conflicting objects rather than replacing them.
create schema workforce_private;
revoke all on schema workforce_private from public, anon, authenticated;
grant usage on schema workforce_private to authenticated, service_role;

create table public.tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 100),
  time_zone text not null default 'UTC',
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now()
);

create table public.tenant_memberships (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 100),
  role text not null check (role in ('owner', 'admin', 'manager', 'employee')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  created_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

-- The composite primary key supports tenant-bound foreign keys in future modules.
-- A user may hold different roles in multiple companies.
create index tenant_memberships_user_idx
  on public.tenant_memberships (user_id, tenant_id) where status = 'active';

create function workforce_private.check_time_zone() returns trigger
language plpgsql security invoker set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.time_zone) then
    raise exception using errcode = '22023', message = 'Unknown time zone';
  end if;
  return new;
end;
$$;
revoke all on function workforce_private.check_time_zone() from public, anon, authenticated;
create trigger tenant_time_zone before insert or update of time_zone on public.tenants
  for each row execute function workforce_private.check_time_zone();

-- Internal lookup prevents recursive membership policies. No caller-supplied
-- user ID, role, email or user_metadata participates in authorization.
-- SECURITY DEFINER is confined to this non-exposed schema, with a fixed empty
-- search_path and fully qualified objects. It returns only the caller's role.
create function workforce_private.membership_role(target_tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role
  from public.tenant_memberships m
  join public.tenants t on t.id = m.tenant_id
  join auth.users u on u.id = m.user_id
  where m.tenant_id = target_tenant
    and m.user_id = (select auth.uid())
    and m.status = 'active' and t.status = 'active'
    and u.email_confirmed_at is not null and u.is_anonymous is not true
$$;
revoke all on function workforce_private.membership_role(uuid) from public, anon, authenticated;
grant execute on function workforce_private.membership_role(uuid) to authenticated;

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;

-- Revoke grants explicitly: project default privileges are not a security policy.
revoke all on public.tenants, public.tenant_memberships from public, anon, authenticated;
grant select on public.tenants, public.tenant_memberships to authenticated;
grant select, insert, update, delete on public.tenants, public.tenant_memberships to service_role;

create policy tenant_member_read on public.tenants for select to authenticated
  using (workforce_private.membership_role(id) is not null);

create policy membership_read on public.tenant_memberships for select to authenticated
  using (
    workforce_private.membership_role(tenant_id) is not null
    and (
      user_id = (select auth.uid())
      or workforce_private.membership_role(tenant_id) in ('owner', 'admin', 'manager')
    )
  );

-- No authenticated mutation policies or signup/provisioning RPCs yet.
-- Future writes need separately reviewed authorization and audit coverage.
commit;
