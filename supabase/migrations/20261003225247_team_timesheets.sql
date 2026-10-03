begin;

-- Preserve the applied baseline; only hoist the signed identity into an initplan.
alter policy time_clock_entries_read on public.time_clock_entries using (
 workforce_private.membership_role(tenant_id) in ('owner','admin') or
 (workforce_private.membership_role(tenant_id) is not null and exists (
  select 1 from public.agents a where a.tenant_id=time_clock_entries.tenant_id
   and a.id=time_clock_entries.agent_id and a.user_id=(select auth.uid()) and a.status='active'
 ))
);

create index time_clock_completion_version on public.time_clock_audit(tenant_id,id desc) where action='clock_out';

create function public.read_team_timesheets(
 target_tenant uuid, start_date date, end_date date, target_agent uuid default null,
 page_limit integer default 50, after_entry jsonb default null, export_all boolean default false
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid(); role_name text; company public.tenants%rowtype;
 instant timestamptz:=statement_timestamp(); lower_bound timestamptz; upper_bound timestamptz;
 version text; summary jsonb; agents jsonb; entries jsonb; ids uuid[]; next_cursor jsonb;
 cursor_time timestamptz; cursor_id uuid; result_limit integer;
begin
 role_name:=workforce_private.membership_role(target_tenant);
 if actor is null or coalesce(role_name,'') not in ('owner','admin') then raise exception using errcode='42501',message='Only owners and admins can review team timesheets'; end if;
 select * into company from public.tenants where id=target_tenant and status='active';
 if not found then raise exception using errcode='42501',message='Company access unavailable'; end if;
 if start_date is null or end_date is null or not isfinite(start_date) or not isfinite(end_date)
  or start_date not between date '0001-01-01' and date '9999-12-31'
  or end_date not between date '0001-01-01' and date '9999-12-31' or start_date>end_date
  or page_limit is null or page_limit not between 1 and 100 or export_all is null
  or (export_all and after_entry is not null) then raise exception using errcode='22023',message='Choose valid team timesheet filters'; end if;
 lower_bound:=workforce_private.time_clock_day_start(start_date,company.time_zone);
 upper_bound:=workforce_private.time_clock_day_start(end_date+1,company.time_zone);
 -- Completed entries are immutable in this baseline. Tenant mutations use one
 -- mutex, so each new completion advances this committed bigint audit version.
 select coalesce(max(id)::text,'0') into version from public.time_clock_audit where tenant_id=target_tenant and action='clock_out';
 if after_entry is not null then
  if jsonb_typeof(after_entry) is distinct from 'object' or octet_length(after_entry::text)>2048
   or exists(select 1 from jsonb_object_keys(after_entry) k where k not in ('tenantId','actorId','startDate','endDate','agentId','timeZone','datasetVersion','startedAt','entryId'))
   or (after_entry->>'tenantId') is distinct from target_tenant::text or (after_entry->>'actorId') is distinct from actor::text
   or (after_entry->>'startDate') is distinct from start_date::text or (after_entry->>'endDate') is distinct from end_date::text
   or (after_entry->>'agentId') is distinct from target_agent::text or (after_entry->>'timeZone') is distinct from company.time_zone
   or after_entry->>'datasetVersion' is null then raise exception using errcode='22023',message='Team timesheet filters changed. Refresh from the latest records'; end if;
  if (after_entry->>'datasetVersion') is distinct from version then raise exception using errcode='40001',message='Completed timesheets changed. Refresh before loading more'; end if;
  cursor_time:=(after_entry->>'startedAt')::timestamptz; cursor_id:=(after_entry->>'entryId')::uuid;
  if cursor_time is null or not isfinite(cursor_time) or cursor_id is null then raise exception using errcode='22023',message='Invalid timesheet cursor'; end if;
 end if;

 -- The aggregate covers the entire selected scope, independently of its page.
 with scoped as materialized (
  select e.* from public.time_clock_entries e where e.tenant_id=target_tenant and e.ended_at is not null
   and e.started_at>=lower_bound and e.started_at<upper_bound and (target_agent is null or e.agent_id=target_agent)
 ), pauses as (
  select b.entry_id,sum(greatest(0,extract(epoch from (coalesce(b.ended_at,e.ended_at)-b.started_at)))) as unpaid
  from public.time_clock_breaks b join scoped e on e.tenant_id=b.tenant_id and e.id=b.entry_id where not b.paid group by b.entry_id
 ), totals as (
  select e.agent_id,greatest(0,extract(epoch from(e.ended_at-e.started_at))) as elapsed,coalesce(p.unpaid,0) as unpaid
  from scoped e left join pauses p on p.entry_id=e.id
 ) select jsonb_build_object('entryCount',count(*),'agentCount',count(distinct agent_id),
  'elapsedSeconds',coalesce(sum(elapsed),0),'unpaidBreakSeconds',coalesce(sum(unpaid),0),
  'paidSeconds',coalesce(sum(greatest(0,elapsed-unpaid)),0)) into summary from totals;
 if export_all and (summary->>'entryCount')::bigint>10000 then raise exception using errcode='54000',message='Export exceeds 10000 completed records. Narrow the date range or user filter'; end if;
 if not export_all then
  select coalesce(jsonb_agg(jsonb_build_object('id',a.agent_id,'name',a.agent_name) order by a.agent_name,a.agent_id),'[]'::jsonb) into agents from (
   select distinct on(e.agent_id) e.agent_id,e.agent_name from public.time_clock_entries e
   where e.tenant_id=target_tenant and e.ended_at is not null and e.started_at>=lower_bound and e.started_at<upper_bound
   order by e.agent_id,e.started_at desc,e.id desc
  ) a;
 else agents:='[]'::jsonb;end if;
 result_limit:=case when export_all then 10000 else page_limit end;
 select array_agg(q.id order by q.started_at desc,q.id desc) into ids from (
  select e.id,e.started_at from public.time_clock_entries e where e.tenant_id=target_tenant and e.ended_at is not null
   and e.started_at>=lower_bound and e.started_at<upper_bound and (target_agent is null or e.agent_id=target_agent)
   and (after_entry is null or (e.started_at,e.id)<(cursor_time,cursor_id))
  order by e.started_at desc,e.id desc limit result_limit+1
 ) q;
 -- Break arrays are omitted from this review/export DTO; totals remain exact.
 select coalesce(jsonb_agg(workforce_private.time_clock_entry_json(u.id,instant)-'breaks' order by u.ordinality),'[]'::jsonb)
 into entries from unnest(ids[1:result_limit]) with ordinality u(id,ordinality);
 if cardinality(ids)>result_limit then
  if export_all then raise exception using errcode='54000',message='Incomplete export refused'; end if;
  select jsonb_build_object('tenantId',target_tenant,'actorId',actor,'startDate',start_date,'endDate',end_date,'agentId',target_agent,
   'timeZone',company.time_zone,'datasetVersion',version,'startedAt',e.started_at,'entryId',e.id) into next_cursor from public.time_clock_entries e where e.id=ids[result_limit];
 end if;
 return jsonb_build_object('company',jsonb_build_object('id',company.id,'name',company.name,'time_zone',company.time_zone),
  'role',role_name,'actorId',actor,'filters',jsonb_build_object('startDate',start_date,'endDate',end_date,'agentId',target_agent),
  'timeZone',company.time_zone,'serverTime',instant,'datasetVersion',version,'summary',summary,'agents',agents,
  'entries',entries,'nextCursor',next_cursor,'exportLimit',10000);
end;$$;
revoke all on function public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean) from public,anon,authenticated,service_role;
grant execute on function public.read_team_timesheets(uuid,date,date,uuid,integer,jsonb,boolean) to authenticated;
commit;
