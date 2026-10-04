begin;
-- Organizational Agent-record groups; no Auth or communication authority changes.
create table public.smart_group_segments(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 name text not null check(length(btrim(name)) between 1 and 100),description text not null check(length(description)<=500),
 status text not null default 'active' check(status in('active','archived')),revision integer not null default 1 check(revision>0),
 unique(tenant_id,id)
);
create table public.smart_groups(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,segment_id uuid not null,
 name text not null check(length(btrim(name)) between 1 and 100),description text not null check(length(description)<=500),rules jsonb not null,
 status text not null default 'active' check(status in('active','archived')),revision integer not null default 1 check(revision>0),
 unique(tenant_id,id),foreign key(tenant_id,segment_id) references public.smart_group_segments(tenant_id,id),
 check(jsonb_typeof(rules)='array' and jsonb_array_length(rules) between 1 and 10)
);
create index smart_group_segments_page on public.smart_group_segments(tenant_id,lower(name),id);
create index smart_groups_page on public.smart_groups(tenant_id,segment_id,lower(name),id);
create table public.smart_group_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),segment_id uuid not null,group_id uuid,
 actor_id uuid not null,actor_name text not null,action text not null check(action in('create_segment','edit_segment','archive_segment','restore_segment','create_group','edit_group','archive_group','restore_group')),
 revision integer not null,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,segment_id) references public.smart_group_segments(tenant_id,id),foreign key(tenant_id,group_id) references public.smart_groups(tenant_id,id),foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id)
);
create table workforce_private.smart_group_operations(
 tenant_id uuid not null,actor_id uuid not null,operation_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(tenant_id,actor_id,operation_id),foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.smart_group_operations enable row level security;
revoke all on workforce_private.smart_group_operations from public,anon,authenticated,service_role;
alter table public.smart_group_segments enable row level security;
alter table public.smart_groups enable row level security;
alter table public.smart_group_audit enable row level security;
revoke all on public.smart_group_segments,public.smart_groups,public.smart_group_audit from public,anon,authenticated,service_role;
grant select on public.smart_group_segments,public.smart_groups,public.smart_group_audit to authenticated;
create policy smart_group_segments_read on public.smart_group_segments for select to authenticated using(workforce_private.membership_role(tenant_id) in('owner','admin'));
create policy smart_groups_read on public.smart_groups for select to authenticated using(workforce_private.membership_role(tenant_id) in('owner','admin'));
create policy smart_group_audit_read on public.smart_group_audit for select to authenticated using(workforce_private.membership_role(tenant_id) in('owner','admin'));

-- Only boolean eligibility for company-bound records; never Auth contact/profile data.
create function workforce_private.smart_group_eligibility(t uuid) returns table(id uuid,eligible boolean) language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin') then raise exception using errcode='42501',message='Groups unavailable';end if;
 return query select a.id,coalesce(m.status='active' and u.email_confirmed_at is not null and not u.is_anonymous,false)
 from public.agents a left join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.user_id left join auth.users u on u.id=a.user_id
 where a.tenant_id=t and a.status='active';
end $$;
create function workforce_private.smart_group_fields(t uuid) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_array(jsonb_build_object('key','title','label','Title'),jsonb_build_object('key','team','label','Team'))||coalesce((select jsonb_agg(jsonb_build_object('key','custom:'||key,'label',label)order by position,key)from public.agent_fields where tenant_id=t),'[]')
$$;
create function workforce_private.smart_group_invalid_fields(t uuid,rules jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(field order by field),'[]')from(select distinct r->>'field' field from jsonb_array_elements(rules)r where r->>'field' not in('title','team')and not exists(select 1 from public.agent_fields f where f.tenant_id=t and 'custom:'||f.key=r->>'field'))s
$$;
create function workforce_private.smart_group_utf16(v text)returns integer language sql immutable security invoker set search_path=''as $$select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'')c$$;
create function workforce_private.smart_group_nonblank(v text)returns boolean language sql immutable security invoker set search_path=''as $$select v is not null and v<>''and v !~ U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$'$$;
create function workforce_private.smart_group_validate_rules(t uuid,rules jsonb) returns void language plpgsql stable security invoker set search_path='' as $$
declare r jsonb;v jsonb;begin
 if rules is null or jsonb_typeof(rules)<>'array' or jsonb_array_length(rules) not between 1 and 10 then raise exception using errcode='22023',message='Invalid rules';end if;
 for r in select value from jsonb_array_elements(rules)loop
  if jsonb_typeof(r) is distinct from 'object' or (select array_agg(k order by k)from jsonb_object_keys(r)k)is distinct from array['field','values'] or jsonb_typeof(r->'field') is distinct from 'string' or jsonb_typeof(r->'values') is distinct from 'array' or jsonb_array_length(r->'values') not between 1 and 25 then raise exception using errcode='22023',message='Invalid rule';end if;
  if (select count(distinct alt.value)from jsonb_array_elements(r->'values')alt)<>jsonb_array_length(r->'values')then raise exception using errcode='22023',message='Duplicate alternative';end if;
  for v in select value from jsonb_array_elements(r->'values')loop
   if jsonb_typeof(v) is distinct from 'string' or not workforce_private.smart_group_nonblank(v#>>'{}') or workforce_private.smart_group_utf16(v#>>'{}')>500 then raise exception using errcode='22023',message='Invalid alternative';end if;
  end loop;
 end loop;
 if workforce_private.smart_group_invalid_fields(t,rules)<>'[]'::jsonb then raise exception using errcode='22023',message='Unknown field';end if;
end $$;
create function workforce_private.smart_group_matches(a public.agents,rules jsonb) returns boolean language sql immutable security invoker set search_path='' as $$
 select not exists(select 1 from jsonb_array_elements(rules)r where not exists(select 1 from jsonb_array_elements_text(r->'values')v where v=case r->>'field' when 'title' then nullif(a.title,'')when 'team'then nullif(a.team,'')else nullif(a.custom_fields->>substr(r->>'field',8),'')end))
$$;
create function workforce_private.smart_group_dataset(t uuid) returns text language sql stable security invoker set search_path='' as $$
 select md5(coalesce(string_agg(jsonb_build_array(a.id,a.revision,a.first_name,a.last_name,a.title,a.team,a.custom_fields,a.user_id,e.eligible)::text,'|'order by a.id),'empty')||(select coalesce(string_agg(jsonb_build_array(id,segment_id,status,revision)::text,'|'order by id),'empty')from public.smart_groups where tenant_id=t)||(select coalesce(string_agg(jsonb_build_array(id,status,revision)::text,'|'order by id),'empty')from public.smart_group_segments where tenant_id=t))
 from public.agents a join workforce_private.smart_group_eligibility(t)e on e.id=a.id where a.tenant_id=t and a.status='active'
$$;
create function workforce_private.smart_group_counts(t uuid,rules jsonb) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('records',count(*),'unlinked',count(*)filter(where a.user_id is null),'eligible',count(*)filter(where a.user_id is not null and e.eligible),'unavailable',count(*)filter(where a.user_id is not null and not e.eligible))
 from public.agents a join workforce_private.smart_group_eligibility(t)e on e.id=a.id where a.tenant_id=t and a.status='active'and workforce_private.smart_group_matches(a,rules)
$$;
create function workforce_private.smart_group_segment_json(s public.smart_group_segments) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',s.id,'name',s.name,'description',s.description,'status',s.status,'revision',s.revision,'activeGroupCount',n,'canArchive',s.status='active'and n=0,'canRestore',s.status='archived')from(select count(*)n from public.smart_groups where tenant_id=s.tenant_id and segment_id=s.id and status='active')q
$$;
create function workforce_private.smart_group_json(g public.smart_groups) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',g.id,'segmentId',g.segment_id,'name',g.name,'description',g.description,'status',g.status,'revision',g.revision,'rules',g.rules,'needsReview',bad<>'[]'::jsonb,'invalidFields',bad,'counts',case when bad='[]'::jsonb then workforce_private.smart_group_counts(g.tenant_id,g.rules)else null end,'canEdit',p.status='active','canArchive',g.status='active','canRestore',g.status='archived'and p.status='active'and bad='[]'::jsonb)
 from public.smart_group_segments p cross join lateral(select workforce_private.smart_group_invalid_fields(g.tenant_id,g.rules)bad)q where p.tenant_id=g.tenant_id and p.id=g.segment_id
$$;

create function workforce_private.save_smart_group(t uuid,op uuid,change jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());actor_name text;act text:=change->>'action';keys text[];s public.smart_group_segments;g public.smart_groups;receipt workforce_private.smart_group_operations;res jsonb;sid uuid;gid uuid;rev integer;begin
 if t is null or op is null or jsonb_typeof(change)<>'object' or act is null or octet_length(change::text)>40960 then raise exception using errcode='22023',message='Invalid group operation';end if;
 -- Serialize short tenant writes; profile reads remain dynamic and do not take this lock.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t::text,47));
 perform 1 from public.tenants where id=t for share;perform 1 from auth.users where id=actor for share;
 select display_name into actor_name from public.tenant_memberships where tenant_id=t and user_id=actor for share;
 if coalesce(workforce_private.membership_role(t),'') not in('owner','admin')then raise exception using errcode='42501',message='Groups unavailable';end if;
 keys:=case act when 'create_segment'then array['action','name','description']when 'edit_segment'then array['action','segmentId','revision','name','description']when 'archive_segment'then array['action','segmentId','revision']when 'restore_segment'then array['action','segmentId','revision']when 'create_group'then array['action','segmentId','name','description','rules']when 'edit_group'then array['action','groupId','revision','segmentId','name','description','rules']when 'archive_group'then array['action','groupId','revision']when 'restore_group'then array['action','groupId','revision']end;
 if keys is null or (select array_agg(k order by k)from jsonb_object_keys(change)k)is distinct from(select array_agg(k order by k)from unnest(keys)k)or exists(select 1 from jsonb_each(change)where value='null'::jsonb)then raise exception using errcode='22023',message='Invalid fields';end if;
 if change?'revision' and(jsonb_typeof(change->'revision')<>'number'or (change->>'revision')!~'^[1-9][0-9]{0,9}$'or (change->>'revision')::numeric>2147483646)then raise exception using errcode='22023',message='Invalid revision';end if;
 select * into receipt from workforce_private.smart_group_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then if receipt.payload<>change then raise exception using errcode='40001',message='Retry changed';end if;return receipt.result;end if;
 if act in('create_segment','edit_segment','create_group','edit_group')and(jsonb_typeof(change->'name') is distinct from 'string'or not workforce_private.smart_group_nonblank(change->>'name')or workforce_private.smart_group_utf16(change->>'name')not between 1 and 100 or jsonb_typeof(change->'description') is distinct from 'string'or workforce_private.smart_group_utf16(change->>'description')>500)then raise exception using errcode='22023',message='Invalid details';end if;
 if act like '%group' and act<>'create_group'then
  gid:=(change->>'groupId')::uuid;select * into g from public.smart_groups where tenant_id=t and id=gid for update;if not found then raise exception using errcode='42501',message='Group unavailable';end if;
  if g.revision<>(change->>'revision')::integer then raise exception using errcode='40001',message='Group changed';end if;sid:=g.segment_id;
 end if;
 if change?'segmentId'then sid:=(change->>'segmentId')::uuid;end if;
 if sid is not null then select * into s from public.smart_group_segments where tenant_id=t and id=sid for update;if not found then raise exception using errcode='42501',message='Segment unavailable';end if;end if;
 if act in('create_group','edit_group','restore_group')then
  if s.status<>'active'then raise exception using errcode='40001',message='Parent archived';end if;
  -- Lock all current field rows for validation; removal waits until this write completes.
  perform 1 from public.agent_fields where tenant_id=t order by key for share;
  perform workforce_private.smart_group_validate_rules(t,case when act='restore_group'then g.rules else change->'rules'end);
 end if;
 if act='create_segment'then
  insert into public.smart_group_segments(tenant_id,name,description)values(t,btrim(change->>'name'),change->>'description')returning * into s;sid:=s.id;rev:=1;
 elsif act in('edit_segment','archive_segment','restore_segment')then
  if s.revision<>(change->>'revision')::integer or act='archive_segment'and s.status<>'active'or act='restore_segment'and s.status<>'archived'then raise exception using errcode='40001',message='Segment changed';end if;
  if act='archive_segment'and exists(select 1 from public.smart_groups where tenant_id=t and segment_id=sid and status='active')then raise exception using errcode='40001',message='Active groups remain';end if;
  update public.smart_group_segments set name=case when act='edit_segment'then btrim(change->>'name')else name end,description=case when act='edit_segment'then change->>'description'else description end,status=case act when 'archive_segment'then 'archived'when 'restore_segment'then 'active'else status end,revision=revision+1 where tenant_id=t and id=sid returning revision into rev;
 elsif act='create_group'then
  insert into public.smart_groups(tenant_id,segment_id,name,description,rules)values(t,sid,btrim(change->>'name'),change->>'description',change->'rules')returning * into g;gid:=g.id;rev:=1;
 else
  if act='archive_group'and g.status<>'active'or act='restore_group'and g.status<>'archived'then raise exception using errcode='40001',message='Group lifecycle changed';end if;
  update public.smart_groups set segment_id=sid,name=case when act='edit_group'then btrim(change->>'name')else name end,description=case when act='edit_group'then change->>'description'else description end,rules=case when act='edit_group'then change->'rules'else rules end,status=case act when 'archive_group'then 'archived'when 'restore_group'then 'active'else status end,revision=revision+1 where tenant_id=t and id=gid returning revision into rev;
 end if;
 res:=jsonb_build_object('operationId',op,'action',act,'segmentId',sid,'revision',rev);if gid is not null then res:=res||jsonb_build_object('groupId',gid);end if;
 insert into public.smart_group_audit(tenant_id,segment_id,group_id,actor_id,actor_name,action,revision)values(t,sid,gid,actor,actor_name,act,rev);
 insert into workforce_private.smart_group_operations values(t,actor,op,change,res);return res;
end $$;
create function public.save_smart_group(target_tenant uuid,operation_id uuid,change jsonb)returns jsonb language sql security invoker set search_path=''as $$select workforce_private.save_smart_group(target_tenant,operation_id,change)$$;

create function public.read_smart_groups_access(target_tenant uuid,group_ids uuid[]default '{}',segment_ids uuid[]default '{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare r text:=workforce_private.membership_role(target_tenant);begin
 if coalesce(r,'')not in('owner','admin')then raise exception using errcode='42501',message='Groups unavailable';end if;
 if group_ids is null or segment_ids is null or cardinality(group_ids)>100 or cardinality(segment_ids)>100 then raise exception using errcode='22023',message='Invalid access query';end if;
 return jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',r,'fieldFingerprint',md5(workforce_private.smart_group_fields(target_tenant)::text),'datasetVersion',workforce_private.smart_group_dataset(target_tenant),
 'groups',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'segmentId',segment_id,'revision',revision,'status',status)),'[]')from public.smart_groups where tenant_id=target_tenant and id=any(group_ids)),
 'segments',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'status',status)),'[]')from public.smart_group_segments where tenant_id=target_tenant and id=any(segment_ids)));
end $$;

create function public.read_smart_groups(target_tenant uuid,read_kind text default 'groups',target_group uuid default null,target_segment uuid default null,status_filter text default 'active',search_text text default '',page_limit integer default 50,after_item jsonb default null,preview_rules jsonb default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare role_name text:=workforce_private.membership_role(target_tenant);fields jsonb;fp text;dv text;scope jsonb;res jsonb;rows jsonb;total_count bigint;counts jsonb;next_page jsonb;position text;last_id uuid;selected_rules jsonb;g public.smart_groups;s public.smart_group_segments;invalid jsonb;matched bigint;begin
 if coalesce(role_name,'')not in('owner','admin')then raise exception using errcode='42501',message='Groups unavailable';end if;
 if read_kind is null or status_filter is null or read_kind not in('groups','segments','members','preview')or status_filter not in('all','active','archived')or search_text is null or length(search_text)>100 or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid filters';end if;
 fields:=workforce_private.smart_group_fields(target_tenant);fp:=md5(fields::text);dv:=workforce_private.smart_group_dataset(target_tenant);
 if read_kind='members'then
  select * into g from public.smart_groups where tenant_id=target_tenant and id=target_group;if not found then raise exception using errcode='42501',message='Group unavailable';end if;
  select * into s from public.smart_group_segments where tenant_id=target_tenant and id=g.segment_id;selected_rules:=g.rules;invalid:=workforce_private.smart_group_invalid_fields(target_tenant,selected_rules);
 elsif read_kind='preview'then perform workforce_private.smart_group_validate_rules(target_tenant,preview_rules);selected_rules:=preview_rules;invalid:='[]';
 elsif target_segment is not null then perform 1 from public.smart_group_segments where tenant_id=target_tenant and id=target_segment;if not found then raise exception using errcode='42501',message='Segment unavailable';end if;
 end if;
 scope:=jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',role_name,'kind',read_kind,'groupId',target_group,'segmentId',target_segment,'status',status_filter,'search',search_text,'fieldFingerprint',fp,'datasetVersion',dv,'rulesFingerprint',case when selected_rules is null then null else md5(selected_rules::text)end,'groupRevision',g.revision);
 if after_item is not null then
  if jsonb_typeof(after_item)<>'object'or (select array_agg(k order by k)from jsonb_object_keys(after_item)k)<>array['id','position','scope']or jsonb_typeof(after_item->'position')<>'string'or length(after_item->>'position')>500 or (after_item->>'id')::uuid is null then raise exception using errcode='22023',message='Invalid cursor';end if;
  if after_item->'scope'<>scope then raise exception using errcode='40001',message='Group population or filters changed';end if;
 end if;
 res:=jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',role_name,'fieldFingerprint',fp,'datasetVersion',dv,'serverTime',statement_timestamp());
 if read_kind='groups'then
  select jsonb_build_object('total',count(*),'active',count(*)filter(where status='active'),'archived',count(*)filter(where status='archived'),'needsReview',count(*)filter(where workforce_private.smart_group_invalid_fields(target_tenant,x.rules)<>'[]'::jsonb))into counts from public.smart_groups x where tenant_id=target_tenant and(target_segment is null or segment_id=target_segment)and strpos(lower(name),lower(search_text))>0;
  with page as(select x.*,lower(x.name)sort_key from public.smart_groups x where tenant_id=target_tenant and(target_segment is null or segment_id=target_segment)and(status_filter='all'or status=status_filter)and strpos(lower(name),lower(search_text))>0 and(after_item is null or(lower(name),id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(name),id limit page_limit+1)
  select coalesce(jsonb_agg(workforce_private.smart_group_json(row(p.id,p.tenant_id,p.segment_id,p.name,p.description,p.rules,p.status,p.revision)::public.smart_groups)order by sort_key,id)filter(where n<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where n=page_limit),(array_agg(id order by n)filter(where n=page_limit))[1]into rows,total_count,position,last_id from(select p.*,(row_number()over(order by sort_key,id))n from page p)p;
  -- A row expanded by the page CTE is not the table composite; construct explicitly below.
  res:=res||jsonb_build_object('company',(select jsonb_build_object('id',id,'name',name,'time_zone',time_zone)from public.tenants where id=target_tenant),'fields',fields,'groups',rows,'counts',counts);
 elsif read_kind='segments'then
  select jsonb_build_object('total',count(*),'active',count(*)filter(where status='active'),'archived',count(*)filter(where status='archived'))into counts from public.smart_group_segments where tenant_id=target_tenant and strpos(lower(name),lower(search_text))>0;
  with page as(select x.*,lower(x.name)sort_key from public.smart_group_segments x where tenant_id=target_tenant and(status_filter='all'or status=status_filter)and strpos(lower(name),lower(search_text))>0 and(after_item is null or(lower(name),id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(name),id limit page_limit+1)
  select coalesce(jsonb_agg(workforce_private.smart_group_segment_json(row(p.id,p.tenant_id,p.name,p.description,p.status,p.revision)::public.smart_group_segments)order by sort_key,id)filter(where n<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where n=page_limit),(array_agg(id order by n)filter(where n=page_limit))[1]into rows,total_count,position,last_id from(select p.*,row_number()over(order by sort_key,id)n from page p)p;
  res:=res||jsonb_build_object('segments',rows,'counts',counts);
 else
  if invalid='[]'::jsonb then
   counts:=workforce_private.smart_group_counts(target_tenant,selected_rules);
   select count(*)into matched from public.agents a where tenant_id=target_tenant and status='active'and workforce_private.smart_group_matches(a,selected_rules)and strpos(lower(first_name||' '||last_name),lower(search_text))>0;
   with page as(select a.*,e.eligible,lower(first_name||' '||last_name)sort_key from public.agents a join workforce_private.smart_group_eligibility(target_tenant)e on e.id=a.id where tenant_id=target_tenant and status='active'and workforce_private.smart_group_matches(a,selected_rules)and strpos(lower(first_name||' '||last_name),lower(search_text))>0 and(after_item is null or(lower(first_name||' '||last_name),a.id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(first_name||' '||last_name),a.id limit page_limit+1)
   select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',first_name||' '||last_name,'title',title,'team',team,'linkStatus',case when user_id is null then 'unlinked'when eligible then 'eligible'else 'unavailable'end)order by sort_key,id)filter(where n<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where n=page_limit),(array_agg(id order by n)filter(where n=page_limit))[1]into rows,total_count,position,last_id from(select p.*,row_number()over(order by sort_key,id)n from page p)p;
  else counts:=null;matched:=null;rows:='[]';total_count:=0;end if;
  res:=res||jsonb_build_object('fields',fields,'members',rows,'counts',counts,'matchedCount',matched);
  if read_kind='members'then res:=res||jsonb_build_object('group',workforce_private.smart_group_json(g),'segment',workforce_private.smart_group_segment_json(s));else res:=res||jsonb_build_object('rules',selected_rules);end if;
 end if;
 next_page:=case when total_count>0 then jsonb_build_object('scope',scope,'id',last_id,'position',position)else null end;return res||jsonb_build_object('nextCursor',next_page);
end $$;
-- Explicit ACLs also neutralize hosted public-schema default grants.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='workforce_private'and(p.proname like 'smart_group_%'or p.proname='save_smart_group')or n.nspname='public'and p.proname in('save_smart_group','read_smart_groups','read_smart_groups_access')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);
  execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end $$;
commit;
