-- Additive read-only reporting. All eighteen registered migrations remain immutable.
create function workforce_private.forms_reporting_filters(kind text,p jsonb) returns void
language plpgsql immutable security invoker set search_path='' as $$
declare a date;b date;
begin
 if kind is null or kind not in('entries','status','summary','field') or jsonb_typeof(p) is distinct from 'object'
 or (select array_agg(k order by k) from jsonb_object_keys(p)k) is distinct from array['fieldAnswer','fieldId','from','review','search','submission','to']
 or jsonb_typeof(p->'review') is distinct from 'string' or p->>'review' not in('all','reviewed','not_reviewed')
 or jsonb_typeof(p->'submission') is distinct from 'string' or p->>'submission' not in('all','submitted','not_submitted')
 or jsonb_typeof(p->'fieldAnswer') is distinct from 'string' or p->>'fieldAnswer' not in('all','answered','empty')
 or jsonb_typeof(p->'search') is distinct from 'string' or workforce_private.knowledge_utf16(p->>'search')>100 or octet_length(p->>'search')>512
 or kind<>'status' and p->>'submission'<>'all'
 or kind<>'field' and (p->'fieldId'<>'null'::jsonb or p->>'fieldAnswer'<>'all')
 or kind='field' and not workforce_private.knowledge_uuid(p->'fieldId')
 then raise exception using errcode='22023',message='Invalid report filters';end if;
 if (p->'from'='null'::jsonb) is distinct from (p->'to'='null'::jsonb) then raise exception using errcode='22023',message='Choose both report dates';end if;
 if p->'from'<>'null'::jsonb then
  if jsonb_typeof(p->'from') is distinct from 'string' or jsonb_typeof(p->'to') is distinct from 'string'
  or p->>'from'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or p->>'to'!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then raise exception using errcode='22023',message='Invalid civil dates';end if;
  a:=(p->>'from')::date;b:=(p->>'to')::date;
  if to_char(a,'YYYY-MM-DD')<>p->>'from' or to_char(b,'YYYY-MM-DD')<>p->>'to' or a>b or b-a+1>366 then raise exception using errcode='22023',message='Report range must contain at most 366 calendar days';end if;
 end if;
exception when datetime_field_overflow or invalid_datetime_format then raise exception using errcode='22023',message='Invalid report dates';
end$$;

create function workforce_private.forms_reporting_rows(t uuid,f uuid,p jsonb) returns table(id uuid,actor_id uuid,author_name text,submitted_at timestamptz,reviewed boolean,answers jsonb)
language plpgsql stable security invoker set search_path='' as $$
declare tz text;
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 perform workforce_private.forms_reporting_filters('entries',p);
 select q.time_zone into tz from public.tenants q where q.id=t;
 return query select y.id,y.actor_id,y.author_name,y.submitted_at,y.reviewed,y.answers from public.form_responses y where y.tenant_id=t and y.form_id=f and y.status='submitted'
 and (p->'from'='null'::jsonb or (y.submitted_at at time zone tz)::date between (p->>'from')::date and (p->>'to')::date)
 and (p->>'review'='all' or p->>'review'='reviewed' and y.reviewed or p->>'review'='not_reviewed' and not y.reviewed)
 and strpos(lower(y.author_name),lower(p->>'search'))>0;
end$$;

create function workforce_private.forms_reporting_answered(f jsonb,a jsonb) returns boolean
language sql immutable security invoker set search_path='' as $$
 select coalesce(a is not null and a<>'null'::jsonb and case f->>'kind'
 when 'text' then workforce_private.knowledge_nonblank(a#>>'{}')
 when 'multiple_choice' then jsonb_typeof(a)='array' and jsonb_array_length(a)>0
 else true end,false)
$$;

create function workforce_private.forms_reporting_valid(t uuid,f uuid,r uuid) returns void
language plpgsql stable security definer set search_path='' as $$
declare x public.forms;y public.form_responses;
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 select * into x from public.forms where tenant_id=t and id=f;
 select * into y from public.form_responses where tenant_id=t and form_id=f and id=r and status='submitted';
 if not found then raise exception using errcode='42501',message='Submitted report row unavailable';end if;
 if not x.schema_frozen or x.schema is distinct from y.schema or not workforce_private.forms_schema_valid(y.schema)
 or not workforce_private.forms_answers_valid(y.schema,y.answers,true) then raise exception using errcode='XX000',message='Submitted report data invalid';end if;
end$$;

-- Validate the schema once and reuse it for all bounded submitted answers.
create function workforce_private.forms_reporting_validate_scope(t uuid,f uuid,p jsonb) returns void
language plpgsql stable security definer set search_path='' as $$
declare x public.forms;y record;has_required boolean;scope_count bigint;scope_bytes bigint;
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 select * into x from public.forms where tenant_id=t and id=f;
 if not workforce_private.forms_schema_valid(x.schema) then raise exception using errcode='XX000',message='Invalid report schema';end if;
 select count(*),coalesce(sum(octet_length(z.answers::text)),0)into scope_count,scope_bytes from workforce_private.forms_reporting_rows(t,f,p)z;
 if scope_count>10000 or scope_bytes>2097152 or scope_count*octet_length(x.schema::text)>67108864 then raise exception using errcode='54000',message='Complete report validation workload too large';end if;
 select exists(select 1 from jsonb_array_elements(x.schema)sf(value) where sf.value->>'kind'<>'description' and (sf.value->>'required')::boolean) into has_required;
 for y in select (fr.schema is not distinct from x.schema) as schema_matches,z.answers from workforce_private.forms_reporting_rows(t,f,p)z join public.form_responses fr on fr.tenant_id=t and fr.form_id=f and fr.id=z.id loop
  if not x.schema_frozen or y.schema_matches is distinct from true or not (not has_required and y.answers='{}'::jsonb) and not workforce_private.forms_answers_valid(x.schema,y.answers,true) then raise exception using errcode='XX000',message='Invalid submitted report answers';end if;
 end loop;
end$$;

create function workforce_private.forms_reporting_schema(t uuid,f uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 select schema into s from public.forms where tenant_id=t and id=f;
 if not workforce_private.forms_schema_valid(s) then raise exception using errcode='XX000',message='Invalid report schema';end if;
 return s;
end$$;

create function workforce_private.forms_reporting_version(t uuid,f uuid) returns text
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 return md5(jsonb_build_array(workforce_private.forms_version(t,'manage',f),
 (select schema from public.forms where tenant_id=t and id=f),
 (select coalesce(jsonb_agg(jsonb_build_array(actor_id,name) order by actor_id),'[]') from public.form_assignments where tenant_id=t and form_id=f))::text);
end$$;

-- Capacity exposes only existing management edit availability, after scope checks.
create function workforce_private.forms_reporting_capacity(t uuid,f uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') or workforce_private.forms_access(t,f,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 return (select retained_rows<4096 from workforce_private.form_history_counter where id);
end$$;

create function public.read_forms_reporting_access(target_tenant uuid,target_form uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r text:=workforce_private.membership_role(target_tenant);
begin
 if coalesce(r,'') not in('owner','admin') or workforce_private.forms_access(target_tenant,target_form,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 return jsonb_build_object('tenantId',target_tenant,'actorId',auth.uid(),'role',r,'formId',target_form,
 'formRevision',(select revision from public.forms where tenant_id=target_tenant and id=target_form),
 'collectionVersion',workforce_private.forms_reporting_version(target_tenant,target_form),
 'company',(select jsonb_build_object('id',id,'name',name,'time_zone',time_zone) from public.tenants where id=target_tenant));
end$$;

create function public.read_forms_reporting(target_tenant uuid,target_form uuid,report_kind text default 'entries',filters jsonb default '{"from":null,"to":null,"review":"all","search":"","submission":"all","fieldId":null,"fieldAnswer":"all"}',page_limit integer default 50,after_item jsonb default null,export_all boolean default false) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare r text:=workforce_private.membership_role(target_tenant);x public.forms;p jsonb;scope jsonb;version text;res jsonb;rows jsonb;position jsonb:=null;cursor_id uuid;cursor_key text;
 total bigint;reviewed bigint;raw_bytes bigint;edit_capacity boolean;assigned bigint;eligible bigint;submitted bigint;not_submitted bigint;field jsonb;stats jsonb:='[]';options jsonb;answered bigint;empty bigint;matched bigint;y record;limit_rows integer;
begin
 if coalesce(r,'') not in('owner','admin') or workforce_private.forms_access(target_tenant,target_form,'manage') is distinct from true then raise exception using errcode='42501',message='Forms reporting unavailable';end if;
 perform workforce_private.forms_reporting_filters(report_kind,filters);
 if page_limit is null or page_limit not between 1 and 100 or export_all is null or export_all and (report_kind not in('entries','status') or after_item is not null) or report_kind='summary' and (after_item is not null or page_limit<>50) then raise exception using errcode='22023',message='Invalid report paging';end if;
 select * into x from public.forms where tenant_id=target_tenant and id=target_form;
 -- This validator is deliberately guarded, including when a draft has no rows.
 x.schema:=workforce_private.forms_reporting_schema(target_tenant,target_form);
 version:=workforce_private.forms_reporting_version(target_tenant,target_form);
 p:=filters||jsonb_build_object('submission','all','fieldId',null,'fieldAnswer','all');
 if report_kind='status' then p:=p||jsonb_build_object('search','');end if;
 scope:=jsonb_build_object('tenantId',target_tenant,'actorId',auth.uid(),'role',r,'formId',target_form,'kind',report_kind,'filters',filters,'version',version);
 if after_item is not null then
  if jsonb_typeof(after_item) is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(after_item)k) is distinct from array['position','scope']
  or jsonb_typeof(after_item->'position') is distinct from 'object' or (select array_agg(k order by k) from jsonb_object_keys(after_item->'position')k) is distinct from array['id','key']
  or not workforce_private.knowledge_uuid(after_item->'position'->'id') or jsonb_typeof(after_item->'position'->'key') is distinct from 'string' or workforce_private.knowledge_utf16(after_item->'position'->>'key')>200 then raise exception using errcode='22023',message='Invalid report cursor';end if;
  if after_item->'scope' is distinct from scope then raise exception using errcode='40001',message='Report scope or collection changed';end if;
  cursor_id:=(after_item->'position'->>'id')::uuid;cursor_key:=after_item->'position'->>'key';
 end if;
 select count(*),count(*) filter(where z.reviewed),coalesce(sum(octet_length(z.answers::text)),0) into total,reviewed,raw_bytes from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z;
 if (report_kind in('summary','field') or export_all and report_kind='entries') and (total>10000 or raw_bytes>2097152 or total*octet_length(x.schema::text)>67108864) then raise exception using errcode='54000',message='Complete report scope too large';end if;
 -- Validate complete summary/field/export scopes before aggregating or constructing answer JSON.
 if report_kind in('summary','field') or export_all and report_kind='entries' then perform workforce_private.forms_reporting_validate_scope(target_tenant,target_form,p);end if;
 res:=jsonb_build_object('tenantId',target_tenant,'actorId',auth.uid(),'role',r,'kind',report_kind,'filters',filters,'company',
 (select jsonb_build_object('id',id,'name',name,'time_zone',time_zone) from public.tenants where id=target_tenant),
 'form',workforce_private.forms_form_json(target_tenant,target_form,'manage'),'collectionVersion',version,'serverTime',workforce_private.forms_time(clock_timestamp()));
 if report_kind='entries' then
  if cursor_id is not null and not exists(select 1 from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z where z.id=cursor_id and workforce_private.forms_time(z.submitted_at)=cursor_key) then raise exception using errcode='40001',message='Report position changed';end if;
  limit_rows:=case when export_all then 10000 else page_limit end;
  if export_all then edit_capacity:=workforce_private.forms_reporting_capacity(target_tenant,target_form);end if;
  -- Export rows were completely validated above in this same snapshot.
  if not export_all then
  for y in select id from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z where cursor_id is null or(z.submitted_at,z.id)<(cursor_key::timestamptz,cursor_id) order by submitted_at desc,id desc limit limit_rows loop perform workforce_private.forms_reporting_valid(target_tenant,target_form,y.id);end loop;
  end if;
  with available as(select * from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z where cursor_id is null or(z.submitted_at,z.id)<(cursor_key::timestamptz,cursor_id) order by submitted_at desc,id desc limit limit_rows+1),page as(select * from available order by submitted_at desc,id desc limit limit_rows)
  select coalesce((select jsonb_agg(case when export_all then jsonb_build_object('id',fr.id,'formId',fr.form_id,'actorId',fr.actor_id,'authorName',fr.author_name,'revision',fr.revision,'status',fr.status,
   'submittedAt',workforce_private.forms_time(fr.submitted_at),'updatedAt',workforce_private.forms_time(fr.updated_at),'lastEditedBy',fr.last_edited_by,'lastEditorName',fr.last_editor_name,'lastEditedAt',workforce_private.forms_time(fr.last_edited_at),
   'reviewed',fr.reviewed,'reviewedAt',workforce_private.forms_time(fr.reviewed_at),'reviewedBy',fr.reviewed_by,'reviewerName',fr.reviewer_name,
   'canEdit',x.status='published'and fr.revision<2147483647 and fr.content_edits<50 and edit_capacity,'canReview',x.status='published'and fr.revision<2147483647,'answers',z.answers,'formName',fr.form_name) else workforce_private.forms_response_json(target_tenant,z.id,'manage') end order by z.submitted_at desc,z.id desc) from page z join public.form_responses fr on fr.tenant_id=target_tenant and fr.form_id=target_form and fr.id=z.id and fr.status='submitted'),'[]'),
  case when not export_all and (select count(*) from available)>page_limit then (select jsonb_build_object('id',id,'key',workforce_private.forms_time(submitted_at)) from page order by submitted_at,id limit 1) else null end into rows,position;
  res:=res||jsonb_build_object('responses',rows,'counts',jsonb_build_object('total',total,'reviewed',reviewed,'notReviewed',total-reviewed));
  if export_all then res:=res||jsonb_build_object('schema',x.schema);end if;
 elsif report_kind='status' then
  select count(*),count(*) filter(where(u->>'eligible')::boolean) into assigned,eligible from jsonb_array_elements(workforce_private.forms_assignees(target_tenant,target_form))u;
  if assigned>500 then raise exception using errcode='54000',message='Assigned report scope too large';end if;
  -- forms_eligible is intentionally not exposed by the applied baseline. Its
  -- guarded management assignee helper supplies fresh eligibility without ACL changes.
  with assignees as(select u from jsonb_array_elements(workforce_private.forms_assignees(target_tenant,target_form))u),scope_rows as(
   select u, z.id response_id from assignees a left join workforce_private.forms_reporting_rows(target_tenant,target_form,p)z on z.actor_id=(u->>'actorId')::uuid
   where strpos(lower(u->>'name'),lower(filters->>'search'))>0 and(filters->>'submission'='all' or filters->>'submission'='submitted' and z.id is not null or filters->>'submission'='not_submitted' and z.id is null))
  select count(*),count(*) filter(where response_id is not null),count(*) filter(where response_id is null),count(*) filter(where(u->>'eligible')::boolean) into total,submitted,not_submitted,matched from scope_rows;
  if cursor_id is not null and not exists(select 1 from jsonb_array_elements(workforce_private.forms_assignees(target_tenant,target_form))u left join workforce_private.forms_reporting_rows(target_tenant,target_form,p)z on z.actor_id=(u->>'actorId')::uuid
  where(u->>'actorId')::uuid=cursor_id and lower(u->>'name')=cursor_key and strpos(lower(u->>'name'),lower(filters->>'search'))>0 and(filters->>'submission'='all' or filters->>'submission'='submitted' and z.id is not null or filters->>'submission'='not_submitted' and z.id is null)) then raise exception using errcode='40001',message='Status position changed';end if;
  limit_rows:=case when export_all then 500 else page_limit end;
  with scope_rows as(select u,z.id response_id,lower(u->>'name')k,(u->>'actorId')::uuid aid from jsonb_array_elements(workforce_private.forms_assignees(target_tenant,target_form))u left join workforce_private.forms_reporting_rows(target_tenant,target_form,p)z on z.actor_id=(u->>'actorId')::uuid
   where strpos(lower(u->>'name'),lower(filters->>'search'))>0 and(filters->>'submission'='all' or filters->>'submission'='submitted' and z.id is not null or filters->>'submission'='not_submitted' and z.id is null)),available as(select * from scope_rows where cursor_id is null or(k,aid)>(cursor_key,cursor_id) order by k,aid limit limit_rows+1),page as(select * from available order by k,aid limit limit_rows)
  select coalesce((select jsonb_agg(u||jsonb_build_object('response',case when response_id is null then null else workforce_private.forms_response_json(target_tenant,response_id,'manage')end) order by k,aid) from page),'[]'),
  case when not export_all and(select count(*) from available)>page_limit then(select jsonb_build_object('id',aid,'key',k) from page order by k desc,aid desc limit 1) else null end into rows,position;
  res:=res||jsonb_build_object('users',rows,'counts',jsonb_build_object('total',total,'submitted',submitted,'notSubmitted',not_submitted,'eligible',matched,'assignmentTotal',assigned,'assignmentEligible',eligible));
 elsif report_kind='summary' then
  -- One submitted-answer snapshot and one flattening pass. Option counts use
  -- a small grouped distribution rather than rescanning every full response.
  with source as materialized (select z.answers from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z),
  fields as materialized(select value f,n from jsonb_array_elements(x.schema)with ordinality q(value,n)where value->>'kind'<>'description'),
  flat as materialized(select e.key,e.value from source z cross join lateral jsonb_each(z.answers)e),
  present as(select f->>'id' id,count(*)filter(where workforce_private.forms_reporting_answered(f,v.value))answered from fields left join flat v on v.key=f->>'id' group by f),
  selections as materialized(
   select v.key,v.value#>>'{}' option_id from flat v join fields on f->>'id'=v.key where f->>'kind'in('yes_no','single_choice')
   union all select v.key,o#>>'{}' from flat v join fields on f->>'id'=v.key cross join lateral jsonb_array_elements(case when f->>'kind'='multiple_choice' then v.value else '[]'::jsonb end)o),
  distributions as(select key,option_id,count(*)c from selections group by key,option_id),
  result as(select n,jsonb_build_object('fieldId',f->>'id','total',total,'answered',present.answered,'empty',total-present.answered,'options',
   case when f->>'kind'='yes_no' then jsonb_build_array(
    jsonb_build_object('id','true','label','Yes','count',coalesce((select c from distributions where key=f->>'id' and option_id='true'),0)),
    jsonb_build_object('id','false','label','No','count',coalesce((select c from distributions where key=f->>'id' and option_id='false'),0)))
   when f->>'kind'in('single_choice','multiple_choice')then(select coalesce(jsonb_agg(jsonb_build_object('id',o->>'id','label',o->>'label','count',coalesce(d.c,0))order by i),'[]')from jsonb_array_elements(f->'options')with ordinality q(o,i)left join distributions d on d.key=f->>'id' and d.option_id=o->>'id')else '[]'::jsonb end)s
   from fields join present on present.id=f->>'id')
  select coalesce(jsonb_agg(s order by n),'[]')into stats from result;
  res:=res||jsonb_build_object('schema',x.schema,'fields',stats,'counts',jsonb_build_object('total',total,'reviewed',reviewed,'notReviewed',total-reviewed));
 else
  select value into field from jsonb_array_elements(x.schema) where value->>'id'=lower(filters->>'fieldId') and value->>'kind'<>'description';
  if not found or not x.schema_frozen then raise exception using errcode='22023',message='Choose an answerable frozen report field';end if;
  select count(*) filter(where workforce_private.forms_reporting_answered(field,z.answers->(field->>'id'))) into answered from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z;empty:=total-answered;
  matched:=case filters->>'fieldAnswer' when 'answered' then answered when 'empty' then empty else total end;
  if cursor_id is not null and not exists(select 1 from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z where z.id=cursor_id and workforce_private.forms_time(z.submitted_at)=cursor_key and(filters->>'fieldAnswer'='all' or(filters->>'fieldAnswer'='answered')=workforce_private.forms_reporting_answered(field,z.answers->(field->>'id')))) then raise exception using errcode='40001',message='Field position changed';end if;
  with available as(select z.*,workforce_private.forms_reporting_answered(field,z.answers->(field->>'id'))is_answered from workforce_private.forms_reporting_rows(target_tenant,target_form,p)z where(cursor_id is null or(z.submitted_at,z.id)<(cursor_key::timestamptz,cursor_id)) and(filters->>'fieldAnswer'='all' or(filters->>'fieldAnswer'='answered')=workforce_private.forms_reporting_answered(field,z.answers->(field->>'id'))) order by submitted_at desc,id desc limit page_limit+1),page as(select * from available order by submitted_at desc,id desc limit page_limit)
  select coalesce((select jsonb_agg(jsonb_build_object('response',workforce_private.forms_response_json(target_tenant,z.id,'manage'),'answer',z.answers->(field->>'id'),'answered',is_answered) order by submitted_at desc,id desc) from page z),'[]'),
  case when(select count(*) from available)>page_limit then(select jsonb_build_object('id',id,'key',workforce_private.forms_time(submitted_at)) from page order by submitted_at,id limit 1) else null end into rows,position;
  res:=res||jsonb_build_object('field',field,'responses',rows,'counts',jsonb_build_object('total',total,'answered',answered,'empty',empty,'matched',matched));
 end if;
 if not export_all and report_kind<>'summary' then res:=res||jsonb_build_object('nextCursor',case when position is null then null else jsonb_build_object('scope',scope,'position',position) end);end if;
 if octet_length(res::text)>8388608 then raise exception using errcode='54000',message='Report response too large';end if;
 return res;
end$$;

-- No prior ACL is changed. Public RPCs remain signed invokers; private data
-- validation/version helpers independently guard current owner/admin access.
revoke all on function workforce_private.forms_reporting_filters(text,jsonb),workforce_private.forms_reporting_rows(uuid,uuid,jsonb),workforce_private.forms_reporting_answered(jsonb,jsonb),workforce_private.forms_reporting_valid(uuid,uuid,uuid),workforce_private.forms_reporting_validate_scope(uuid,uuid,jsonb),workforce_private.forms_reporting_schema(uuid,uuid),workforce_private.forms_reporting_version(uuid,uuid),workforce_private.forms_reporting_capacity(uuid,uuid),public.read_forms_reporting(uuid,uuid,text,jsonb,integer,jsonb,boolean),public.read_forms_reporting_access(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function workforce_private.forms_reporting_filters(text,jsonb),workforce_private.forms_reporting_rows(uuid,uuid,jsonb),workforce_private.forms_reporting_answered(jsonb,jsonb),workforce_private.forms_reporting_valid(uuid,uuid,uuid),workforce_private.forms_reporting_validate_scope(uuid,uuid,jsonb),workforce_private.forms_reporting_schema(uuid,uuid),workforce_private.forms_reporting_version(uuid,uuid),workforce_private.forms_reporting_capacity(uuid,uuid),public.read_forms_reporting(uuid,uuid,text,jsonb,integer,jsonb,boolean),public.read_forms_reporting_access(uuid,uuid) to authenticated;
