-- Add exact draft-subset publication without changing legacy publication or schema.
begin;
create function workforce_private.publish_rota_shifts(t uuid,sid uuid,expected_revision integer,shift_rows jsonb) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.rota_schedules;r text;entry jsonb;ids uuid[];result jsonb;new_revision integer;
begin
 if actor is null or t is null or sid is null then raise exception using errcode='42501',message='Schedule access unavailable';end if;
 if expected_revision is null or expected_revision not between 1 and 2147483646 or jsonb_typeof(shift_rows) is distinct from 'array' then raise exception using errcode='22023',message='Invalid draft selection';end if;
 if jsonb_array_length(shift_rows) not between 1 and 5000 or octet_length(shift_rows::text)>524288 then raise exception using errcode='22023',message='Draft selection capacity exceeded';end if;
 for entry in select value from jsonb_array_elements(shift_rows) loop
  if jsonb_typeof(entry) is distinct from 'object' or entry-array['id','revision']<>'{}'::jsonb or not entry ?& array['id','revision'] or jsonb_typeof(entry->'id') is distinct from 'string' or entry->>'id' !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' or jsonb_typeof(entry->'revision') is distinct from 'number' then raise exception using errcode='22023',message='Invalid draft target';end if;
  if (entry->>'revision')::numeric<>trunc((entry->>'revision')::numeric) or (entry->>'revision')::numeric not between 1 and 2147483646 then raise exception using errcode='22023',message='Invalid draft revision';end if;
 end loop;
 select array_agg((value->>'id')::uuid order by (value->>'id')::uuid) into ids from jsonb_array_elements(shift_rows);
 if (select count(distinct id) from unnest(ids) id)<>cardinality(ids) then raise exception using errcode='22023',message='Duplicate draft target';end if;
 -- Same tenant mutex and lock order as legacy saves and template applications.
 perform 1 from public.tenants where id=t and status='active' for update;
 if not found then raise exception using errcode='42501',message='Company unavailable';end if;
 perform 1 from auth.users where id=actor for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor for share;
 r:=workforce_private.membership_role(t);
 select * into s from public.rota_schedules where tenant_id=t and id=sid for update;
 if not found or r is null or workforce_private.rota_manage(t,sid) is distinct from true then raise exception using errcode='42501',message='Schedule access unavailable';end if;
 if r='manager' then
  perform 1 from public.rota_admins where tenant_id=t and schedule_id=sid and user_id=actor for share;
  if not found then raise exception using errcode='42501',message='Schedule grant revoked';end if;
 end if;
 if s.status<>'active' then raise exception using errcode='22023',message='Restore the schedule before publishing';end if;
 if s.revision<>expected_revision then raise exception using errcode='40001',message='Schedule changed';end if;
 perform 1 from public.rota_shifts where tenant_id=t and schedule_id=sid and id=any(ids) order by id for update;
 if (select count(*) from public.rota_shifts x join jsonb_array_elements(shift_rows) e on x.id=(e.value->>'id')::uuid where x.tenant_id=t and x.schedule_id=sid and x.status='draft' and x.revision=(e.value->>'revision')::numeric::integer)<>cardinality(ids) then raise exception using errcode='40001',message='Selected draft shifts changed';end if;
 perform 1 from public.agents a where a.tenant_id=t and exists(select 1 from public.rota_shifts x where x.tenant_id=t and x.schedule_id=sid and x.id=any(ids) and x.agent_id=a.id) order by a.id for share;
 perform 1 from public.rota_agents a where a.tenant_id=t and a.schedule_id=sid and exists(select 1 from public.rota_shifts x where x.tenant_id=t and x.schedule_id=sid and x.id=any(ids) and x.agent_id=a.agent_id) order by a.agent_id for share;
 perform 1 from auth.users u where exists(select 1 from public.rota_shifts x join public.agents a on a.tenant_id=x.tenant_id and a.id=x.agent_id where x.tenant_id=t and x.schedule_id=sid and x.id=any(ids) and a.user_id=u.id) order by u.id for share;
 perform 1 from public.tenant_memberships m where m.tenant_id=t and exists(select 1 from public.rota_shifts x join public.agents a on a.tenant_id=x.tenant_id and a.id=x.agent_id where x.tenant_id=t and x.schedule_id=sid and x.id=any(ids) and a.user_id=m.user_id) order by m.user_id for share;
 if exists(select 1 from public.rota_shifts x left join public.agents a on a.tenant_id=x.tenant_id and a.id=x.agent_id left join public.rota_agents roster on roster.tenant_id=x.tenant_id and roster.schedule_id=x.schedule_id and roster.agent_id=x.agent_id left join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.user_id where x.tenant_id=t and x.schedule_id=sid and x.id=any(ids) and (a.id is null or a.status<>'active' or roster.agent_id is null or (a.user_id is not null and (m.user_id is null or m.status<>'active')))) then raise exception using errcode='23503',message='Selected shifts contain an inactive or unassigned worker';end if;
 update public.rota_shifts set status='published',published_at=now(),revision=revision+1 where tenant_id=t and schedule_id=sid and id=any(ids);
 update public.rota_schedules set revision=revision+1 where tenant_id=t and id=sid returning revision into new_revision;
 insert into public.rota_audit(tenant_id,schedule_id,actor_user_id,action,revision) values(t,sid,actor,'publish',new_revision);
 select jsonb_agg(jsonb_build_object('id',id,'revision',revision) order by id) into result from public.rota_shifts where tenant_id=t and schedule_id=sid and id=any(ids);
 return jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',actor,'schedule_id',sid,'schedule_revision',new_revision,'published_count',cardinality(ids),'shifts',result);
end$$;
create function public.publish_rota_shifts(target_tenant uuid,target_schedule uuid,expected_revision integer,shift_rows jsonb) returns jsonb
language sql volatile security invoker set search_path='' as $$select workforce_private.publish_rota_shifts(target_tenant,target_schedule,expected_revision,shift_rows)$$;
revoke all on function workforce_private.publish_rota_shifts(uuid,uuid,integer,jsonb),public.publish_rota_shifts(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function workforce_private.publish_rota_shifts(uuid,uuid,integer,jsonb),public.publish_rota_shifts(uuid,uuid,integer,jsonb) to authenticated;
commit;
