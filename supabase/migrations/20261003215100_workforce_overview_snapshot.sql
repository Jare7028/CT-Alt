begin;

-- Authorization and both aggregates use the calling statement's snapshot.
-- Invoker rights preserve the existing signed-user grants and RLS policies.
create function public.read_workforce_overview(target_tenant uuid) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if coalesce(workforce_private.membership_role(target_tenant), '') not in ('owner', 'admin', 'manager') then
    raise exception using errcode = '42501', message = 'Company overview access denied';
  end if;

  return (
    select pg_catalog.jsonb_build_object('agents', a.counts, 'memberships', m.counts)
    from (
      select pg_catalog.jsonb_build_object(
        'active', count(*) filter (where status = 'active'),
        'archived', count(*) filter (where status = 'archived'),
        'linked', count(*) filter (where status = 'active' and user_id is not null),
        'unlinked', count(*) filter (where status = 'active' and user_id is null)
      ) as counts
      from public.agents where tenant_id = target_tenant
    ) a
    cross join (
      select pg_catalog.jsonb_build_object(
        'owner', count(*) filter (where role = 'owner'),
        'admin', count(*) filter (where role = 'admin'),
        'manager', count(*) filter (where role = 'manager'),
        'employee', count(*) filter (where role = 'employee')
      ) as counts
      from public.tenant_memberships where tenant_id = target_tenant and status = 'active'
    ) m
  );
end;
$$;

revoke all on function public.read_workforce_overview(uuid) from public, anon, authenticated, service_role;
grant execute on function public.read_workforce_overview(uuid) to authenticated;

commit;
