-- Independently implemented Shift Templates. Existing applied rota functions are unchanged.
begin;
create table public.rota_shift_templates (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null, schedule_id uuid not null,
 name text not null check(workforce_private.knowledge_utf16(btrim(name)) between 1 and 100), title text not null check(workforce_private.knowledge_utf16(title)<=100), job_id uuid not null,
 start_minute integer not null check(start_minute between 0 and 1439), end_minute integer not null check(end_minute between 0 and 1439),
 end_day_offset integer not null check(end_day_offset between 0 and 2), revision integer not null default 1 check(revision>0),
 deleted_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), creator_user_id uuid not null references auth.users(id),
 unique(tenant_id,schedule_id,id), foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id),
 foreign key(tenant_id,schedule_id,job_id) references public.rota_jobs(tenant_id,schedule_id,id),
 check(end_day_offset*1440+end_minute-start_minute between 1 and 2880)
);
create index rota_templates_page on public.rota_shift_templates(tenant_id,schedule_id,(lower(name) collate "C"),id) where deleted_at is null;
create table public.rota_template_audit (
 id bigint generated always as identity primary key, tenant_id uuid not null, schedule_id uuid not null, template_id uuid not null,
 actor_id uuid not null references auth.users(id), action text not null check(action in('create','edit','duplicate','delete','apply')),
 template_revision integer not null check(template_revision>0), schedule_revision integer not null check(schedule_revision>0), shift_id uuid references public.rota_shifts(id), occurred_at timestamptz not null default now(),
 foreign key(tenant_id,schedule_id,template_id) references public.rota_shift_templates(tenant_id,schedule_id,id),
 check((action='apply')=(shift_id is not null))
);
create table workforce_private.rota_template_operations (
 tenant_id uuid not null references public.tenants(id), actor_id uuid not null references auth.users(id), operation_id uuid not null,
 schedule_id uuid not null, action text not null check(action in('create','edit','duplicate','delete','apply')), target_template_id uuid,
 state text not null check(state in('recorded','closed_absent')), payload_hash text, result jsonb,
 primary key(tenant_id,actor_id,operation_id), foreign key(tenant_id,schedule_id) references public.rota_schedules(tenant_id,id),
 foreign key(tenant_id,schedule_id,target_template_id) references public.rota_shift_templates(tenant_id,schedule_id,id),
 check((state='recorded' and payload_hash ~ '^[0-9a-f]{64}$' and result is not null) or (state='closed_absent' and payload_hash is null and result is null))
);
alter table public.rota_shift_templates enable row level security;
alter table public.rota_template_audit enable row level security;
alter table workforce_private.rota_template_operations enable row level security;
revoke all on public.rota_shift_templates,public.rota_template_audit,workforce_private.rota_template_operations from public,anon,authenticated,service_role;
grant select on public.rota_shift_templates,public.rota_template_audit to authenticated;
create policy rota_templates_read on public.rota_shift_templates for select to authenticated using(deleted_at is null and workforce_private.rota_manage(tenant_id,schedule_id));
create policy rota_templates_audit_read on public.rota_template_audit for select to authenticated using(workforce_private.rota_manage(tenant_id,schedule_id));

-- Offset enumeration and exact round-trip avoids PostgreSQL's silent gap/fold coercion.
create function workforce_private.rota_template_instant(local_time timestamp without time zone,zone text,occurrence text) returns timestamptz
language plpgsql stable set search_path='' as $$
declare wall timestamptz;matches timestamptz[];begin
 if local_time is null or local_time < timestamp '0001-01-01' or local_time >= timestamp '10000-01-01' or zone is null or (zone<>'UTC' and zone !~ '^(Africa|America|Antarctica|Arctic|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)/[A-Za-z0-9_+/-]+$') or not exists(select 1 from pg_timezone_names where name=zone) or occurrence is null or occurrence not in('','earlier','later') then raise exception using errcode='22023',message='Invalid shift time zone or occurrence';end if;
 wall:=local_time at time zone 'UTC';
 select array_agg(candidate order by candidate) into matches from (
 select distinct wall-((probe at time zone zone)-(probe at time zone 'UTC')) as candidate from generate_series(wall-interval '36 hours',wall+interval '36 hours',interval '6 hours') probe
 ) x where candidate at time zone zone=local_time;
 if coalesce(cardinality(matches),0)=0 then raise exception using errcode='22007',message='Shift time does not exist';end if;
 if cardinality(matches)>1 and occurrence='' then raise exception using errcode='22008',message='Choose earlier or later shift time';end if;
 return case when occurrence='later' then matches[cardinality(matches)] else matches[1] end;
end$$;
revoke all on function workforce_private.rota_template_instant(timestamp,text,text) from public,anon,authenticated,service_role;

create function public.read_rota_template_access(target_tenant uuid,target_schedule uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare s public.rota_schedules;begin
 if auth.uid() is null or workforce_private.rota_manage(target_tenant,target_schedule) is distinct from true then raise exception using errcode='42501',message='Templates unavailable';end if;
 select * into s from public.rota_schedules where tenant_id=target_tenant and id=target_schedule;
 if not found then raise exception using errcode='42501',message='Templates unavailable';end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',target_tenant,'actorId',auth.uid(),'schedule',jsonb_build_object('id',s.id,'revision',s.revision,'time_zone',s.time_zone,'status',s.status));
end$$;
create function public.read_rota_templates(target_tenant uuid,target_schedule uuid,search_text text default '',page_limit integer default 30,after_row jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare ident jsonb;rows jsonb;total bigint;next_row jsonb;sid uuid;key text;begin
 ident:=public.read_rota_template_access(target_tenant,target_schedule);
 if search_text is null or workforce_private.knowledge_utf16(search_text)>100 or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid template filters';end if;
 if after_row is not null then
 if jsonb_typeof(after_row) is distinct from 'object' or after_row-array['v','tenantId','actorId','scheduleId','scheduleRevision','search','key','id']<>'{}'::jsonb or not after_row ?& array['v','tenantId','actorId','scheduleId','scheduleRevision','search','key','id'] or after_row->>'v' is distinct from '1' or after_row->>'tenantId' is distinct from target_tenant::text or after_row->>'actorId' is distinct from auth.uid()::text or after_row->>'scheduleId' is distinct from target_schedule::text or after_row->>'scheduleRevision' is distinct from ident->'schedule'->>'revision' or after_row->>'search' is distinct from search_text or jsonb_typeof(after_row->'key') is distinct from 'string' or length(after_row->>'key')>200 or jsonb_typeof(after_row->'id') is distinct from 'string' then raise exception using errcode='40001',message='Template page changed';end if;
 sid:=(after_row->>'id')::uuid;key:=after_row->>'key';
 end if;
 select count(*) into total from public.rota_shift_templates where tenant_id=target_tenant and schedule_id=target_schedule and deleted_at is null and strpos(lower(name),lower(search_text))>0;
 with page as (select id,tenant_id,schedule_id,name,title,job_id,start_minute,end_minute,end_day_offset,revision,lower(name) collate "C" as k from public.rota_shift_templates where tenant_id=target_tenant and schedule_id=target_schedule and deleted_at is null and strpos(lower(name),lower(search_text))>0 and (after_row is null or (lower(name) collate "C",id)>(key collate "C",sid)) order by lower(name) collate "C",id limit page_limit+1),
 numbered as(select *,row_number() over(order by k,id) n from page)
 select coalesce(jsonb_agg(to_jsonb(x)-'k'-'n' order by k,id) filter(where n<=page_limit),'[]'::jsonb),
 case when count(*)>page_limit then (select jsonb_build_object('v',1,'tenantId',target_tenant,'actorId',auth.uid(),'scheduleId',target_schedule,'scheduleRevision',(ident->'schedule'->>'revision')::integer,'search',search_text,'key',k,'id',id) from numbered where n=page_limit) else null end into rows,next_row from numbered x;
 return ident||jsonb_build_object('templates',rows,'page',jsonb_build_object('total',total,'nextCursor',next_row));
end$$;

-- Same operation + tenant lock order for commits and absent-closure recovery.
create function workforce_private.rota_template_locks(t uuid,op uuid,sid uuid) returns public.rota_schedules
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.rota_schedules;r text;begin
 if actor is null or op is null or t is null or sid is null then raise exception using errcode='42501',message='Templates unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended(t::text||':'||actor::text||':'||op::text,114));
 perform 1 from public.tenants where id=t and status='active' for update;
 if not found then raise exception using errcode='42501',message='Company unavailable';end if;
 perform 1 from auth.users where id=actor for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor for share;
 r:=workforce_private.membership_role(t);
 select * into s from public.rota_schedules where tenant_id=t and id=sid for update;
 if not found or r is null or workforce_private.rota_manage(t,sid) is distinct from true then raise exception using errcode='42501',message='Templates unavailable';end if;
 if r='manager' then
 perform 1 from public.rota_admins where tenant_id=t and schedule_id=sid and user_id=actor for share;
 if not found then raise exception using errcode='42501',message='Schedule grant revoked';end if;
 end if;
 return s;
end$$;
revoke all on function workforce_private.rota_template_locks(uuid,uuid,uuid) from public,anon,authenticated,service_role;

create function workforce_private.save_rota_template(t uuid,op uuid,change_text text) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare c jsonb;a text;actor uuid:=auth.uid();sid uuid;tid uuid;s public.rota_schedules;x public.rota_shift_templates;rec workforce_private.rota_template_operations;res jsonb;h text;keys text[];k text;aid uuid;linked uuid;start_time timestamptz;end_time timestamptz;d date;new_shift uuid;new_tid uuid;begin
 if change_text is null or octet_length(change_text)>8192 or workforce_private.forms_json_unique(change_text::json) is distinct from true then raise exception using errcode='22023',message='Invalid template request';end if;
 c:=change_text::jsonb;a:=c->>'action';
 if jsonb_typeof(c) is distinct from 'object' or a is null or a not in('create','edit','duplicate','delete','apply') then raise exception using errcode='22023',message='Invalid template action';end if;
 keys:=array['action','schedule_id','schedule_revision'];
 if a<>'create' then keys:=keys||array['template_id','template_revision'];end if;
 if a in('create','edit') then keys:=keys||array['name','title','job_id','start_minute','end_minute','end_day_offset'];end if;
 if a='duplicate' then keys:=keys||array['name'];end if;
 if a='apply' then keys:=keys||array['agent_id','date','start_occurrence','end_occurrence','allow_overlap'];end if;
 if c-keys<>'{}'::jsonb or not c ?& keys then raise exception using errcode='22023',message='Invalid template fields';end if;
 foreach k in array keys loop
 if k in('schedule_revision','template_revision','start_minute','end_minute','end_day_offset') then
 if jsonb_typeof(c->k) is distinct from 'number' or c->>k !~ '^[0-9]{1,10}$' then raise exception using errcode='22023',message='Invalid template number';end if;
 elsif k='allow_overlap' then
 if jsonb_typeof(c->k) is distinct from 'boolean' then raise exception using errcode='22023',message='Invalid overlap acknowledgement';end if;
 else if jsonb_typeof(c->k) is distinct from 'string' then raise exception using errcode='22023',message='Invalid template text';end if;end if;
 end loop;
 if (c->>'schedule_revision')::numeric not between 1 and 2147483646 or (a<>'create' and (c->>'template_revision')::numeric not between 1 and 2147483646) then raise exception using errcode='22023',message='Invalid template revision';end if;
 sid:=(c->>'schedule_id')::uuid;tid:=(c->>'template_id')::uuid;s:=workforce_private.rota_template_locks(t,op,sid);h:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
 select * into rec from workforce_private.rota_template_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then
 if rec.state='closed_absent' or rec.action<>a or rec.schedule_id<>sid or rec.target_template_id is distinct from tid or rec.payload_hash<>h then raise exception using errcode='40001',message='Template operation closed or changed';end if;
 return rec.result;
 end if;
 if s.status<>'active' then raise exception using errcode='22023',message='Restore schedule before using templates';end if;
 if s.revision<>(c->>'schedule_revision')::integer then raise exception using errcode='40001',message='Schedule changed';end if;
 if a<>'create' then
 select * into x from public.rota_shift_templates where tenant_id=t and schedule_id=sid and id=tid and deleted_at is null for update;
 if not found then raise exception using errcode='P0002',message='Template unavailable';end if;
 if x.revision<>(c->>'template_revision')::integer then raise exception using errcode='40001',message='Template changed';end if;
 end if;
 if a in('create','edit','duplicate') and (workforce_private.knowledge_utf16(c->>'name')>100 or workforce_private.knowledge_nonblank(c->>'name') is distinct from true) then raise exception using errcode='22023',message='Choose a template name';end if;
 if a in('create','duplicate') and (select count(*) from public.rota_shift_templates where tenant_id=t and schedule_id=sid)>=500 then raise exception using errcode='54000',message='Template capacity reached';end if;
 if a in('create','edit') then
 if workforce_private.knowledge_utf16(c->>'title')>100 or (c->>'start_minute')::integer not between 0 and 1439 or (c->>'end_minute')::integer not between 0 and 1439 or (c->>'end_day_offset')::integer not between 0 and 2 or (c->>'end_day_offset')::integer*1440+(c->>'end_minute')::integer-(c->>'start_minute')::integer not between 1 and 2880 then raise exception using errcode='22023',message='Invalid template hours';end if;
 if not exists(select 1 from public.rota_jobs where tenant_id=t and schedule_id=sid and id=(c->>'job_id')::uuid) then raise exception using errcode='23503',message='Choose a schedule job';end if;
 end if;
 if a='create' then
 insert into public.rota_shift_templates(tenant_id,schedule_id,name,title,job_id,start_minute,end_minute,end_day_offset,creator_user_id) values(t,sid,btrim(c->>'name'),c->>'title',(c->>'job_id')::uuid,(c->>'start_minute')::integer,(c->>'end_minute')::integer,(c->>'end_day_offset')::integer,actor) returning * into x;
 elsif a='edit' then
 update public.rota_shift_templates set name=btrim(c->>'name'),title=c->>'title',job_id=(c->>'job_id')::uuid,start_minute=(c->>'start_minute')::integer,end_minute=(c->>'end_minute')::integer,end_day_offset=(c->>'end_day_offset')::integer,revision=revision+1,updated_at=now() where id=tid returning * into x;
 elsif a='duplicate' then
 insert into public.rota_shift_templates(tenant_id,schedule_id,name,title,job_id,start_minute,end_minute,end_day_offset,creator_user_id) values(t,sid,btrim(c->>'name'),x.title,x.job_id,x.start_minute,x.end_minute,x.end_day_offset,actor) returning * into x;
 elsif a='delete' then
 update public.rota_shift_templates set deleted_at=now(),updated_at=now(),revision=revision+1 where id=tid returning * into x;
 elsif a='apply' then
 if c->>'date' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Choose a valid date';end if;
 d:=(c->>'date')::date;if d not between date '0001-01-01' and date '9999-12-31' or to_char(d,'YYYY-MM-DD')<>c->>'date' then raise exception using errcode='22023',message='Choose a valid date';end if;
 aid:=(c->>'agent_id')::uuid;
 select user_id into linked from public.agents where tenant_id=t and id=aid and status='active' for share;
 if not found then raise exception using errcode='23503',message='Choose an active assigned worker';end if;
 if linked is not null then
 perform 1 from auth.users where id=linked for share;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=linked and status='active' for share;
 if not found then raise exception using errcode='42501',message='Worker access suspended';end if;
 end if;
 if not exists(select 1 from public.rota_agents where tenant_id=t and schedule_id=sid and agent_id=aid) then raise exception using errcode='23503',message='Worker is not assigned to this schedule';end if;
 start_time:=workforce_private.rota_template_instant(d::timestamp+make_interval(mins=>x.start_minute),s.time_zone,c->>'start_occurrence');
 end_time:=workforce_private.rota_template_instant((d+x.end_day_offset)::timestamp+make_interval(mins=>x.end_minute),s.time_zone,c->>'end_occurrence');
 if end_time<=start_time or end_time-start_time>interval '24 hours' then raise exception using errcode='23514',message='Shift must last up to 24 elapsed hours';end if;
 if exists(select 1 from public.rota_shifts where tenant_id=t and agent_id=aid and starts_at<end_time and ends_at>start_time) and (c->>'allow_overlap')::boolean is not true then raise exception using errcode='P0001',message='Overlapping shift';end if;
 if (select count(*) from public.rota_shifts where tenant_id=t)>=5000 then raise exception using errcode='54000',message='Scheduler capacity reached';end if;
 insert into public.rota_shifts(tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title,status) values(t,sid,aid,x.job_id,start_time,end_time,x.title,'draft') returning id into new_shift;
 end if;
 new_tid:=x.id;update public.rota_schedules set revision=revision+1 where tenant_id=t and id=sid returning * into s;
 res:=jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',actor,'operationId',op,'action',a,'template_id',new_tid,'template_revision',x.revision,'schedule_id',sid,'schedule_revision',s.revision,'shift_id',new_shift);
 insert into public.rota_template_audit(tenant_id,schedule_id,template_id,actor_id,action,template_revision,schedule_revision,shift_id) values(t,sid,new_tid,actor,a,x.revision,s.revision,new_shift);
 insert into workforce_private.rota_template_operations(tenant_id,actor_id,operation_id,schedule_id,action,target_template_id,state,payload_hash,result) values(t,actor,op,sid,a,tid,'recorded',h,res);
 return res;
end$$;
create function public.save_rota_template(target_tenant uuid,operation_id uuid,change_text text) returns jsonb language sql volatile security invoker set search_path='' as $$select workforce_private.save_rota_template(target_tenant,operation_id,change_text)$$;
create function workforce_private.reconcile_rota_template(t uuid,op uuid,a text,sid uuid,tid uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare actor uuid:=auth.uid();s public.rota_schedules;rec workforce_private.rota_template_operations;res jsonb;begin
 if a is null or a not in('create','edit','duplicate','delete','apply') or (a='create')<>(tid is null) then raise exception using errcode='22023',message='Invalid template recovery';end if;
 s:=workforce_private.rota_template_locks(t,op,sid);
 select * into rec from workforce_private.rota_template_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then
 if rec.action<>a or rec.schedule_id<>sid or rec.target_template_id is distinct from tid then raise exception using errcode='40001',message='Template recovery scope changed';end if;
 res:=rec.result;
 else
 if tid is not null and not exists(select 1 from public.rota_shift_templates where tenant_id=t and schedule_id=sid and id=tid) then raise exception using errcode='42501',message='Template unavailable';end if;
 insert into workforce_private.rota_template_operations(tenant_id,actor_id,operation_id,schedule_id,action,target_template_id,state) values(t,actor,op,sid,a,tid,'closed_absent');
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',actor,'operationId',op,'action',a,'scheduleId',sid,'templateId',tid,'status',case when res is null then 'not_recorded' else 'recorded' end,'saved',res);
end$$;
create function public.reconcile_rota_template_operation(target_tenant uuid,operation_id uuid,action_name text,target_schedule uuid,target_template uuid) returns jsonb language sql volatile security invoker set search_path='' as $$select workforce_private.reconcile_rota_template(target_tenant,operation_id,action_name,target_schedule,target_template)$$;
revoke all on function workforce_private.save_rota_template(uuid,uuid,text),workforce_private.reconcile_rota_template(uuid,uuid,text,uuid,uuid),public.save_rota_template(uuid,uuid,text),public.reconcile_rota_template_operation(uuid,uuid,text,uuid,uuid),public.read_rota_template_access(uuid,uuid),public.read_rota_templates(uuid,uuid,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function workforce_private.save_rota_template(uuid,uuid,text),workforce_private.reconcile_rota_template(uuid,uuid,text,uuid,uuid),public.save_rota_template(uuid,uuid,text),public.reconcile_rota_template_operation(uuid,uuid,text,uuid,uuid),public.read_rota_template_access(uuid,uuid),public.read_rota_templates(uuid,uuid,text,integer,jsonb) to authenticated;
commit;
