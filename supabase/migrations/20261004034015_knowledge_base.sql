begin;
-- Original fixed Auth-audience resources. No existing record/communication policy changes.
create table public.knowledge_bases(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),name text not null,description text not null,
 status text not null default 'draft'check(status in('draft','published','archived')),restore_status text check(restore_status in('draft','published')),revision integer not null default 1 check(revision>0),
 unique(tenant_id,id),check((status='archived')=(restore_status is not null))
);
create table public.knowledge_nodes(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,base_id uuid not null,parent_id uuid,kind text not null check(kind in('folder','text','link')),
 name text not null,description text not null,body text,url text,status text not null default 'active'check(status in('active','archived')),revision integer not null default 1 check(revision>0),depth integer not null check(depth between 1 and 16),rank bigint not null check(rank>0),
 unique(tenant_id,base_id,id),foreign key(tenant_id,base_id)references public.knowledge_bases(tenant_id,id),foreign key(tenant_id,base_id,parent_id)references public.knowledge_nodes(tenant_id,base_id,id),
 check((kind='text'and body is not null and url is null)or(kind='link'and url is not null and body is null)or(kind='folder'and body is null and url is null)),check(parent_id is not null or kind='folder')
);
create index knowledge_bases_catalog on public.knowledge_bases(tenant_id,lower(name),id);
create index knowledge_nodes_siblings on public.knowledge_nodes(tenant_id,base_id,parent_id,rank,id);
create index knowledge_nodes_search on public.knowledge_nodes(tenant_id,base_id,lower(name),id);
create table public.knowledge_audience(
 tenant_id uuid not null,base_id uuid not null,actor_id uuid not null,name text not null,
 primary key(tenant_id,base_id,actor_id),foreign key(tenant_id,base_id)references public.knowledge_bases(tenant_id,id),foreign key(tenant_id,actor_id)references public.tenant_memberships(tenant_id,user_id)
);
create index knowledge_audience_actor on public.knowledge_audience(tenant_id,actor_id,base_id);
create table public.knowledge_events(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,base_id uuid not null,node_id uuid,actor_id uuid not null,actor_name text not null,base_revision integer not null,node_revision integer,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,base_id)references public.knowledge_bases(tenant_id,id),foreign key(tenant_id,base_id,node_id)references public.knowledge_nodes(tenant_id,base_id,id),foreign key(tenant_id,actor_id)references public.tenant_memberships(tenant_id,user_id),check((node_id is null)=(node_revision is null))
);
create index knowledge_events_resource on public.knowledge_events(tenant_id,base_id,node_id,actor_id,occurred_at);
create table public.knowledge_audit(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,base_id uuid not null,node_id uuid,actor_id uuid not null,actor_name text not null,action text not null,revision integer not null,node_revision integer,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,base_id)references public.knowledge_bases(tenant_id,id),foreign key(tenant_id,base_id,node_id)references public.knowledge_nodes(tenant_id,base_id,id),foreign key(tenant_id,actor_id)references public.tenant_memberships(tenant_id,user_id)
);
create table workforce_private.knowledge_operations(
 tenant_id uuid not null,actor_id uuid not null,operation_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(tenant_id,actor_id,operation_id),foreign key(tenant_id,actor_id)references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.knowledge_operations enable row level security;
revoke all on workforce_private.knowledge_operations from public,anon,authenticated,service_role;

-- The budget counts decoded values, not jsonb's escaped text representation.
create function workforce_private.knowledge_value_bytes(v jsonb)returns bigint language plpgsql immutable security invoker set search_path=''as $$
declare total bigint:=0;item jsonb;begin
 case jsonb_typeof(v)when 'string'then return octet_length(v#>>'{}');when 'object'then total:=64;for item in select value from jsonb_each(v)loop total:=total+workforce_private.knowledge_value_bytes(item);end loop;when 'array'then total:=32;for item in select value from jsonb_array_elements(v)loop total:=total+workforce_private.knowledge_value_bytes(item);end loop;else return 16;end case;return total;
end$$;
create function workforce_private.knowledge_utf16(v text)returns integer language sql immutable security invoker set search_path=''as $$select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'')c$$;
create function workforce_private.knowledge_nonblank(v text)returns boolean language sql immutable security invoker set search_path=''as $$select v is not null and v<>''and v !~ U&'^[\0009-\000D \00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]+$'$$;
-- Conservative, shared URL grammar: ASCII DNS or canonical decimal IPv4 authority.
create function workforce_private.knowledge_link_valid(v text)returns boolean language plpgsql immutable security invoker set search_path=''as $$
declare parts text[];host text;label text;port text;begin
 if v is null or workforce_private.knowledge_utf16(v)not between 1 and 2000 or v~U&'[\0001-\0020\007F\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]'or strpos(v,chr(92))>0 or v~'%(?![0-9A-Fa-f]{2})'then return false;end if;
 parts:=regexp_match(v,'^https?://([^/?#:]+)(:([0-9]{1,5}))?([/?#].*)?$','i');if parts is null then return false;end if;host:=parts[1];port:=parts[3];
 if port is not null and(port::integer<1 or port::integer>65535)then return false;end if;
 if host~'^[0-9]+(\.[0-9]+){3}$'then return not exists(select 1 from unnest(string_to_array(host,'.'))x where x!~'^(0|[1-9][0-9]{0,2})$'or x::integer>255);end if;
 if length(host)>253 or host!~'^[A-Za-z0-9.-]+$'or split_part(host,'.',cardinality(string_to_array(host,'.')))!~'[A-Za-z]'or split_part(host,'.',cardinality(string_to_array(host,'.')))~*'^0x[0-9a-f]*$'then return false;end if;
 foreach label in array string_to_array(host,'.')loop if label~*'^xn--'or length(label)not between 1 and 63 or label!~'^[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?$'then return false;end if;end loop;return true;
end$$;
create function workforce_private.knowledge_uuid(v jsonb)returns boolean language sql immutable security invoker set search_path=''as $$select coalesce(jsonb_typeof(v)='string'and((v#>>'{}')~*'^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'or(v#>>'{}')in('00000000-0000-0000-0000-000000000000','ffffffff-ffff-ffff-ffff-ffffffffffff')),false)$$;
-- Check current authority once, then walk only the bounded scoped ancestor chain.
create function workforce_private.knowledge_path_active(t uuid,b uuid,n uuid)returns boolean language plpgsql stable security definer set search_path=''as $$
 declare r text:=workforce_private.membership_role(t);next_id uuid:=n;parent uuid;state text;visited uuid[]:='{}';
 begin
  if r is null then return false;end if;
  if r not in('owner','admin')and not exists(select 1 from public.knowledge_bases x join public.knowledge_audience a on a.tenant_id=x.tenant_id and a.base_id=x.id where x.tenant_id=t and x.id=b and x.status='published'and a.actor_id=(select auth.uid()))then return false;end if;
  while next_id is not null loop
   if next_id=any(visited)or cardinality(visited)>=16 then return false;end if;
   select k.parent_id,k.status into parent,state from public.knowledge_nodes k where k.tenant_id=t and k.base_id=b and k.id=next_id;
   if not found or state<>'active'then return false;end if;
   visited:=visited||next_id;next_id:=parent;
  end loop;
  return true;
 end
$$;
create function workforce_private.knowledge_reader(t uuid,b uuid,n uuid default null)returns boolean language sql stable security definer set search_path=''as $$
 select workforce_private.membership_role(t)is not null and exists(select 1 from public.knowledge_bases x join public.knowledge_audience a on a.tenant_id=x.tenant_id and a.base_id=x.id where x.tenant_id=t and x.id=b and x.status='published'and a.actor_id=(select auth.uid()))and workforce_private.knowledge_path_active(t,b,n)
$$;
create function workforce_private.knowledge_access(t uuid,b uuid,n uuid default null)returns boolean language plpgsql stable security definer set search_path=''as $$declare r text:=workforce_private.membership_role(t);begin if r in('owner','admin')then return true;end if;if r is null then return false;end if;return workforce_private.knowledge_reader(t,b,n);end$$;
create function workforce_private.knowledge_eligible(t uuid)returns table(actor_id uuid,eligible boolean)language plpgsql stable security definer set search_path=''as $$
begin if coalesce(workforce_private.membership_role(t),'')not in('owner','admin')then raise exception using errcode='42501',message='Knowledge management unavailable';end if;
 return query select m.user_id,m.status='active'and u.email_confirmed_at is not null and not u.is_anonymous from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t;
end$$;
-- RLS readers see no audience-wide identities, insight events or management audits.
alter table public.knowledge_bases enable row level security;
alter table public.knowledge_nodes enable row level security;
alter table public.knowledge_audience enable row level security;
alter table public.knowledge_events enable row level security;
alter table public.knowledge_audit enable row level security;
revoke all on public.knowledge_bases,public.knowledge_nodes,public.knowledge_audience,public.knowledge_events,public.knowledge_audit from public,anon,authenticated,service_role;
grant select on public.knowledge_bases,public.knowledge_nodes,public.knowledge_audience,public.knowledge_events,public.knowledge_audit to authenticated;
create policy knowledge_bases_read on public.knowledge_bases for select to authenticated using(workforce_private.knowledge_access(tenant_id,id));
create policy knowledge_nodes_read on public.knowledge_nodes for select to authenticated using(workforce_private.knowledge_access(tenant_id,base_id,id));
create policy knowledge_audience_read on public.knowledge_audience for select to authenticated using(workforce_private.membership_role(tenant_id)in('owner','admin')or actor_id=(select auth.uid())and workforce_private.knowledge_reader(tenant_id,base_id));
create policy knowledge_events_read on public.knowledge_events for select to authenticated using(workforce_private.membership_role(tenant_id)in('owner','admin'));
create policy knowledge_audit_read on public.knowledge_audit for select to authenticated using(workforce_private.membership_role(tenant_id)in('owner','admin'));

create function workforce_private.save_knowledge_base(t uuid,op uuid,change jsonb)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid:=(select auth.uid());actor_name text;r text;act text:=change->>'action';keys text[];x public.knowledge_bases;n public.knowledge_nodes;p public.knowledge_nodes;neighbor public.knowledge_nodes;receipt workforce_private.knowledge_operations;res jsonb;bid uuid;nid uuid;pid uuid;ids uuid[];new_ids uuid[];new_depth integer;new_rank bigint;delta integer;event public.knowledge_events;begin
 if t is null or op is null or jsonb_typeof(change)is distinct from 'object'or act is null then raise exception using errcode='22023',message='Invalid knowledge operation';end if;
 if 1024+workforce_private.knowledge_value_bytes(jsonb_build_object('tenantId',t,'operationId',op,'change',change))>262144 then raise exception using errcode='54000',message='Knowledge payload too large';end if;
 -- Reconciliation uses this exact actor/company/operation mutex too.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t::text||actor::text||op::text,63));
 perform 1 from public.tenants where id=t for share;perform 1 from auth.users where id=actor for share;
 select display_name into actor_name from public.tenant_memberships where tenant_id=t and user_id=actor for share;r:=workforce_private.membership_role(t);
 if r is null or act<>'view'and r not in('owner','admin')then raise exception using errcode='42501',message='Knowledge access unavailable';end if;
 keys:=case act when 'create_base'then array['action','name','description','audienceIds']when 'edit_base'then array['action','baseId','revision','name','description']when 'set_audience'then array['action','baseId','revision','audienceIds']when 'publish_base'then array['action','baseId','revision']when 'archive_base'then array['action','baseId','revision']when 'restore_base'then array['action','baseId','revision']when 'create_node'then array['action','baseId','revision','parentId','kind','name','description']when 'edit_node'then array['action','baseId','revision','nodeId','nodeRevision','kind','name','description']when 'move_node'then array['action','baseId','revision','nodeId','nodeRevision','parentId']when 'order_node'then array['action','baseId','revision','nodeId','nodeRevision','direction']when 'archive_node'then array['action','baseId','revision','nodeId','nodeRevision']when 'restore_node'then array['action','baseId','revision','nodeId','nodeRevision']when 'view'then array['action','baseId','revision','nodeId','nodeRevision']end;
 if act in('create_node','edit_node')then if change->>'kind'='text'then keys:=keys||array['body'];elsif change->>'kind'='link'then keys:=keys||array['url'];end if;end if;
 if keys is null or(select array_agg(k order by k)from jsonb_object_keys(change)k)is distinct from(select array_agg(k order by k)from unnest(keys)k)then raise exception using errcode='22023',message='Invalid fields';end if;
 if jsonb_typeof(change->'action')is distinct from 'string'or exists(select 1 from jsonb_each(change)where value='null'::jsonb and key not in('parentId','nodeId','nodeRevision'))then raise exception using errcode='22023',message='Missing fields';end if;
 if act='view'then
  if(change->'nodeId'='null'::jsonb)is distinct from(change->'nodeRevision'='null'::jsonb)then raise exception using errcode='22023',message='Invalid view revision';end if;
 elsif change?'nodeId'and change->'nodeId'='null'::jsonb or change?'nodeRevision'and change->'nodeRevision'='null'::jsonb then raise exception using errcode='22023',message='Missing node';end if;
 if change?'revision'and(jsonb_typeof(change->'revision')is distinct from 'number'or(change->>'revision')!~'^[1-9][0-9]{0,9}$'or(change->>'revision')::numeric>case when act='view'then 2147483647 else 2147483646 end)or change?'nodeRevision'and change->'nodeRevision'<>'null'::jsonb and(jsonb_typeof(change->'nodeRevision')is distinct from 'number'or(change->>'nodeRevision')!~'^[1-9][0-9]{0,9}$'or(change->>'nodeRevision')::numeric>case when act='view'then 2147483647 else 2147483646 end)then raise exception using errcode='22023',message='Invalid revision';end if;
 if exists(select 1 from jsonb_each(change)where key in('baseId','nodeId','parentId')and value<>'null'::jsonb and not workforce_private.knowledge_uuid(value))then raise exception using errcode='22023',message='Invalid resource identity';end if;
 if act<>'view'then perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t::text,64));end if;
 if act<>'create_base'then
  bid:=(change->>'baseId')::uuid;select * into x from public.knowledge_bases where tenant_id=t and id=bid for update;if not found then raise exception using errcode='42501',message='Base unavailable';end if;
  if change?'nodeId'and change->'nodeId'<>'null'::jsonb then nid:=(change->>'nodeId')::uuid;select * into n from public.knowledge_nodes where tenant_id=t and base_id=bid and id=nid for update;if not found then raise exception using errcode='42501',message='Node unavailable';end if;end if;
 end if;
 if act='view'then
  perform 1 from public.knowledge_audience where tenant_id=t and base_id=bid and actor_id=actor for share;
  if not workforce_private.knowledge_reader(t,bid,nid)then raise exception using errcode='42501',message='Reader access unavailable';end if;
 end if;
 select * into receipt from workforce_private.knowledge_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then if receipt.payload<>change then raise exception using errcode='40001',message='Retry payload changed';end if;return receipt.result;end if;
 if act='view'then
  if x.revision<>(change->>'revision')::integer or nid is not null and n.revision<>(change->>'nodeRevision')::integer then raise exception using errcode='40001',message='Rendered resource changed';end if;
 end if;
 if act in('create_base','edit_base','create_node','edit_node')then
  if jsonb_typeof(change->'name')is distinct from 'string'or not workforce_private.knowledge_nonblank(change->>'name')or workforce_private.knowledge_utf16(change->>'name')not between 1 and 100 or jsonb_typeof(change->'description')is distinct from 'string'or workforce_private.knowledge_utf16(change->>'description')>500 then raise exception using errcode='22023',message='Invalid resource details';end if;
 end if;
 if act<>'create_base'and act<>'view'then
  if x.revision<>(change->>'revision')::integer or x.status='archived'and act<>'restore_base'then raise exception using errcode='40001',message='Base changed or archived';end if;
  if nid is not null and n.revision<>(change->>'nodeRevision')::integer then raise exception using errcode='40001',message='Node changed';end if;
 end if;
 if act in('create_base','set_audience')then
  if jsonb_typeof(change->'audienceIds')is distinct from 'array'or jsonb_array_length(change->'audienceIds')>500 or exists(select 1 from jsonb_array_elements(change->'audienceIds')a where not workforce_private.knowledge_uuid(a))then raise exception using errcode='22023',message='Invalid audience';end if;
  select coalesce(array_agg(a::uuid order by a::uuid),'{}')into ids from jsonb_array_elements_text(change->'audienceIds')a;
  if cardinality(ids)<>(select count(distinct a)from unnest(ids)a)or x.status='published'and cardinality(ids)=0 then raise exception using errcode='22023',message='Invalid audience';end if;
  select coalesce(array_agg(a),'{}')into new_ids from unnest(ids)a where not exists(select 1 from public.knowledge_audience k where k.tenant_id=t and k.base_id=bid and k.actor_id=a);
  perform 1 from public.tenant_memberships where tenant_id=t and user_id=any(new_ids)order by user_id for share;perform 1 from auth.users where id=any(new_ids)order by id for share;
  if cardinality(new_ids)<>(select count(*)from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.user_id=any(new_ids)and m.status='active'and u.email_confirmed_at is not null and not u.is_anonymous)then raise exception using errcode='42501',message='New assignee unavailable';end if;
 end if;
 if act in('create_node','edit_node')then
  if change->>'kind'not in('folder','text','link')or jsonb_typeof(change->'kind')is distinct from 'string'or act='edit_node'and n.kind<>change->>'kind'then raise exception using errcode='22023',message='Invalid resource kind';end if;
  if change->>'kind'='text'and(jsonb_typeof(change->'body')is distinct from 'string'or workforce_private.knowledge_utf16(change->>'body')not between 1 and 50000)then raise exception using errcode='22023',message='Invalid text';end if;
  if change->>'kind'='link'and(jsonb_typeof(change->'url')is distinct from 'string'or not workforce_private.knowledge_link_valid(change->>'url'))then raise exception using errcode='22023',message='Invalid external link';end if;
 end if;
 if act in('create_node','move_node','edit_node','order_node','restore_node')then
  pid:=case when act in('create_node','move_node')then(change->>'parentId')::uuid else n.parent_id end;
  if pid is not null then select * into p from public.knowledge_nodes where tenant_id=t and base_id=bid and id=pid for update;
   if not found or p.kind<>'folder'or not workforce_private.knowledge_path_active(t,bid,pid)then raise exception using errcode='40001',message='Active folder required';end if;
  elsif(case when act='create_node'then change->>'kind'else n.kind end)<>'folder'then raise exception using errcode='22023',message='Text and links require folder';end if;
 end if;
 if act='create_base'then
  insert into public.knowledge_bases(tenant_id,name,description)values(t,change->>'name',change->>'description')returning * into x;bid:=x.id;
 elsif act='edit_base'then update public.knowledge_bases set name=change->>'name',description=change->>'description'where id=bid;
 elsif act='publish_base'then
  if x.status<>'draft'or(select count(*)from public.knowledge_audience where tenant_id=t and base_id=bid)not between 1 and 500 then raise exception using errcode='40001',message='Draft with audience required';end if;
  perform 1 from public.tenant_memberships m join public.knowledge_audience a on a.tenant_id=m.tenant_id and a.actor_id=m.user_id where a.tenant_id=t and a.base_id=bid order by m.user_id for share of m;
  perform 1 from auth.users u join public.knowledge_audience a on a.actor_id=u.id where a.tenant_id=t and a.base_id=bid order by u.id for share of u;
  if exists(select 1 from public.knowledge_audience a join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.actor_id join auth.users u on u.id=a.actor_id where a.tenant_id=t and a.base_id=bid and(m.status<>'active'or u.email_confirmed_at is null or u.is_anonymous))then raise exception using errcode='42501',message='Publication audience unavailable';end if;
  update public.knowledge_bases set status='published'where id=bid;
 elsif act='archive_base'then update public.knowledge_bases set restore_status=status,status='archived'where id=bid;
 elsif act='restore_base'then
  if x.status<>'archived'then raise exception using errcode='40001',message='Base not archived';end if;update public.knowledge_bases set status=restore_status,restore_status=null where id=bid;
 elsif act='create_node'then
  new_depth:=coalesce(p.depth,0)+1;if new_depth>16 then raise exception using errcode='22023',message='Maximum resource depth exceeded';end if;
  select coalesce(max(rank),0)+1024 into new_rank from public.knowledge_nodes where tenant_id=t and base_id=bid and parent_id is not distinct from pid;
  insert into public.knowledge_nodes(tenant_id,base_id,parent_id,kind,name,description,body,url,depth,rank)values(t,bid,pid,change->>'kind',change->>'name',change->>'description',change->>'body',change->>'url',new_depth,new_rank)returning * into n;nid:=n.id;
 elsif act='edit_node'then update public.knowledge_nodes set name=change->>'name',description=change->>'description',body=change->>'body',url=change->>'url',revision=revision+1 where id=nid returning * into n;
 elsif act='move_node'then
  if pid=nid or exists(with recursive subtree as(select id from public.knowledge_nodes where id=nid union all select c.id from public.knowledge_nodes c join subtree s on c.parent_id=s.id where c.tenant_id=t and c.base_id=bid)select 1 from subtree where id=pid)then raise exception using errcode='22023',message='Cycle prohibited';end if;
  new_depth:=coalesce(p.depth,0)+1;delta:=new_depth-n.depth;
  if exists(with recursive subtree as(select id,depth from public.knowledge_nodes where id=nid union all select c.id,c.depth from public.knowledge_nodes c join subtree s on c.parent_id=s.id where c.tenant_id=t and c.base_id=bid)select 1 from subtree where depth+delta>16)then raise exception using errcode='22023',message='Moved retained subtree too deep';end if;
  select coalesce(max(rank),0)+1024 into new_rank from public.knowledge_nodes where tenant_id=t and base_id=bid and parent_id is not distinct from pid;
  with recursive subtree as(select id from public.knowledge_nodes where id=nid union all select c.id from public.knowledge_nodes c join subtree s on c.parent_id=s.id where c.tenant_id=t and c.base_id=bid)
  update public.knowledge_nodes set depth=depth+delta,revision=revision+1,parent_id=case when id=nid then pid else parent_id end,rank=case when id=nid then new_rank else rank end where id in(select id from subtree);
  select * into n from public.knowledge_nodes where id=nid;
 elsif act='order_node'then
  if change->>'direction'not in('earlier','later')or jsonb_typeof(change->'direction')is distinct from 'string'then raise exception using errcode='22023',message='Invalid order direction';end if;
  if change->>'direction'='earlier'then select * into neighbor from public.knowledge_nodes where tenant_id=t and base_id=bid and parent_id is not distinct from n.parent_id and(rank,id)<(n.rank,n.id)order by rank desc,id desc limit 1 for update;
  else select * into neighbor from public.knowledge_nodes where tenant_id=t and base_id=bid and parent_id is not distinct from n.parent_id and(rank,id)>(n.rank,n.id)order by rank,id limit 1 for update;end if;
  if not found then raise exception using errcode='40001',message='No adjacent sibling';end if;
  update public.knowledge_nodes set rank=case when id=nid then neighbor.rank else n.rank end,revision=revision+1 where id in(nid,neighbor.id);select * into n from public.knowledge_nodes where id=nid;
 elsif act in('archive_node','restore_node')then
  if act='archive_node'and(n.status<>'active'or exists(select 1 from public.knowledge_nodes where tenant_id=t and base_id=bid and parent_id=nid and status='active'))or act='restore_node'and n.status<>'archived'then raise exception using errcode='40001',message='Resource lifecycle changed or active children remain';end if;
  update public.knowledge_nodes set status=case when act='archive_node'then'archived'else'active'end,revision=revision+1 where id=nid returning * into n;
 elsif act='view'then
  insert into public.knowledge_events(tenant_id,base_id,node_id,actor_id,actor_name,base_revision,node_revision)values(t,bid,nid,actor,actor_name,x.revision,n.revision)returning * into event;
 end if;
 if act in('create_base','set_audience')then
  delete from public.knowledge_audience where tenant_id=t and base_id=bid and not(actor_id=any(ids));
  insert into public.knowledge_audience(tenant_id,base_id,actor_id,name)select t,bid,m.user_id,m.display_name from public.tenant_memberships m where m.tenant_id=t and m.user_id=any(new_ids);
 end if;
 if act not in('create_base','view')then update public.knowledge_bases set revision=revision+1 where id=bid returning * into x;else select * into x from public.knowledge_bases where id=bid;end if;
 res:=jsonb_build_object('operationId',op,'action',act,'baseId',bid,'revision',x.revision);if nid is not null then res:=res||jsonb_build_object('nodeId',nid,'nodeRevision',n.revision);end if;
 if act='view'then res:=res||jsonb_build_object('eventId',event.id,'recordedAt',event.occurred_at);else insert into public.knowledge_audit(tenant_id,base_id,node_id,actor_id,actor_name,action,revision,node_revision)values(t,bid,nid,actor,actor_name,act,x.revision,n.revision);end if;
 insert into workforce_private.knowledge_operations values(t,actor,op,change,res);return res;
end$$;
create function public.save_knowledge_base(target_tenant uuid,operation_id uuid,change jsonb)returns jsonb language sql security invoker set search_path=''as $$select workforce_private.save_knowledge_base(target_tenant,operation_id,change)$$;

create function workforce_private.reconcile_knowledge_view(t uuid,op uuid)returns jsonb language plpgsql security definer set search_path=''as $$
declare actor uuid:=(select auth.uid());r text;receipt workforce_private.knowledge_operations;begin
 if t is null or op is null then raise exception using errcode='22023',message='Invalid reconciliation';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t::text||actor::text||op::text,63));
 perform 1 from public.tenants where id=t for share;perform 1 from auth.users where id=actor for share;perform 1 from public.tenant_memberships where tenant_id=t and user_id=actor for share;r:=workforce_private.membership_role(t);
 if r is null then raise exception using errcode='42501',message='Current company access unavailable';end if;
 select * into receipt from workforce_private.knowledge_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if not found then return jsonb_build_object('tenantId',t,'actorId',actor,'role',r,'operationId',op,'status','not_recorded');end if;
 if receipt.payload->>'action'<>'view'then raise exception using errcode='42501',message='View reconciliation unavailable';end if;
 if not workforce_private.knowledge_reader(t,(receipt.payload->>'baseId')::uuid,(receipt.payload->>'nodeId')::uuid)then raise exception using errcode='42501',message='Current reader access unavailable';end if;
 return jsonb_build_object('tenantId',t,'actorId',actor,'role',r,'operationId',op,'status','recorded');
end$$;
create function public.reconcile_knowledge_view(target_tenant uuid,operation_id uuid)returns jsonb language sql security invoker set search_path=''as $$select workforce_private.reconcile_knowledge_view(target_tenant,operation_id)$$;

create function workforce_private.knowledge_audience_version(t uuid,b uuid)returns text language plpgsql stable security definer set search_path=''as $$
begin if not coalesce(workforce_private.knowledge_access(t,b),false)then raise exception using errcode='42501',message='Base unavailable';end if;
 return(select md5(coalesce(string_agg(jsonb_build_array(a.actor_id,a.name,m.status='active'and u.email_confirmed_at is not null and not u.is_anonymous)::text,'|'order by a.actor_id),'empty'))from public.knowledge_audience a join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.actor_id join auth.users u on u.id=a.actor_id where a.tenant_id=t and a.base_id=b);
end$$;
create function workforce_private.knowledge_tree_version(t uuid,b uuid)returns text language sql stable security invoker set search_path=''as $$select md5(coalesce(string_agg(jsonb_build_array(id,parent_id,kind,status,revision,depth,rank)::text,'|'order by id),'empty'))from public.knowledge_nodes where tenant_id=t and base_id=b$$;
create function workforce_private.knowledge_base_json(t uuid,b uuid)returns jsonb language plpgsql stable security definer set search_path=''as $$
declare x public.knowledge_bases;admin boolean;eligible bigint;total bigint;begin
 if not coalesce(workforce_private.knowledge_access(t,b),false)then raise exception using errcode='42501',message='Base unavailable';end if;
 select * into x from public.knowledge_bases where tenant_id=t and id=b;if not found then raise exception using errcode='42501',message='Base unavailable';end if;admin:=workforce_private.membership_role(t)in('owner','admin');
 select count(*),count(*)filter(where m.status='active'and u.email_confirmed_at is not null and not u.is_anonymous)into total,eligible from public.knowledge_audience a join public.tenant_memberships m on m.tenant_id=a.tenant_id and m.user_id=a.actor_id join auth.users u on u.id=a.actor_id where a.tenant_id=t and a.base_id=b;
 return jsonb_build_object('id',x.id,'name',x.name,'description',x.description,'status',x.status,'restoreStatus',x.restore_status,'revision',x.revision,'audienceCount',total,'eligibleAudienceCount',eligible,'isAssigned',exists(select 1 from public.knowledge_audience where tenant_id=t and base_id=b and actor_id=(select auth.uid())),'canRead',coalesce(workforce_private.knowledge_reader(t,b),false),'canEdit',admin and x.status<>'archived','canPublish',admin and x.status='draft'and total between 1 and 500 and eligible=total,'canArchive',admin and x.status<>'archived','canRestore',admin and x.status='archived');
end$$;
create function workforce_private.knowledge_node_json(n public.knowledge_nodes)returns jsonb language sql stable security invoker set search_path=''as $$
 select jsonb_build_object('id',n.id,'baseId',n.base_id,'parentId',n.parent_id,'kind',n.kind,'name',n.name,'description',n.description,'status',n.status,'revision',n.revision,'depth',n.depth,'rank',n.rank::text,'activeChildCount',(select count(*)from public.knowledge_nodes where tenant_id=n.tenant_id and base_id=n.base_id and parent_id=n.id and status='active'),
 'canEdit',editable,'canMove',editable,'canMoveEarlier',editable and exists(select 1 from public.knowledge_nodes where tenant_id=n.tenant_id and base_id=n.base_id and parent_id is not distinct from n.parent_id and(rank,id)<(n.rank,n.id)),
 'canMoveLater',editable and exists(select 1 from public.knowledge_nodes where tenant_id=n.tenant_id and base_id=n.base_id and parent_id is not distinct from n.parent_id and(rank,id)>(n.rank,n.id)),
 'canArchive',editable and n.status='active'and not exists(select 1 from public.knowledge_nodes where tenant_id=n.tenant_id and base_id=n.base_id and parent_id=n.id and status='active'),'canRestore',editable and n.status='archived')
 from(select workforce_private.membership_role(n.tenant_id)in('owner','admin')and b.status<>'archived'and workforce_private.knowledge_path_active(n.tenant_id,n.base_id,n.parent_id)editable from public.knowledge_bases b where b.tenant_id=n.tenant_id and b.id=n.base_id)q
$$;
-- A bounded primary-key walk avoids fresh-statistics recursive plans scanning
-- unrelated rows through RLS. Every ancestor lookup remains a signed invoker read.
create function workforce_private.knowledge_path(t uuid,b uuid,n uuid)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare next_id uuid:=n;item public.knowledge_nodes;result jsonb:='[]';visited uuid[]:='{}';begin
 while next_id is not null loop
  if next_id=any(visited)or cardinality(visited)>=16 then raise exception using errcode='22023',message='Invalid hierarchy';end if;
  select k.*into item from public.knowledge_nodes k where k.tenant_id=t and k.base_id=b and k.id=next_id;
  if not found then return '[]'::jsonb;end if;
  visited:=visited||item.id;
  result:=jsonb_build_array(jsonb_build_object('id',item.id,'name',item.name,'status',item.status,'revision',item.revision))||result;
  next_id:=item.parent_id;
 end loop;
 return result;
end$$;
create function workforce_private.knowledge_catalog_version(t uuid)returns text language sql stable security invoker set search_path=''as $$select md5(coalesce(string_agg(jsonb_build_array(id,status,revision,workforce_private.knowledge_audience_version(t,id))::text,'|'order by id),'empty'))from public.knowledge_bases where tenant_id=t$$;
create function workforce_private.knowledge_roster_version(t uuid)returns text language sql stable security invoker set search_path=''as $$select md5(coalesce(string_agg(jsonb_build_array(m.user_id,m.display_name,e.eligible)::text,'|'order by m.user_id),'empty'))from public.tenant_memberships m join workforce_private.knowledge_eligible(t)e on e.actor_id=m.user_id where m.tenant_id=t$$;
create function workforce_private.knowledge_event_version(t uuid,b uuid)returns text language sql stable security invoker set search_path=''as $$select md5(coalesce(string_agg(jsonb_build_array(id,actor_id,node_id,occurred_at)::text,'|'order by id),'empty'))from public.knowledge_events where tenant_id=t and base_id=b$$;

create function public.read_knowledge_base_access(target_tenant uuid,read_view text default 'auto',target_base uuid default null,target_node uuid default null,target_bases uuid[]default '{}')returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare r text:=workforce_private.membership_role(target_tenant);v text;x public.knowledge_bases;n public.knowledge_nodes;begin
 if r is null then raise exception using errcode='42501',message='Company unavailable';end if;
 if read_view is null or read_view not in('auto','manage','library')or target_bases is null or cardinality(target_bases)>100 then raise exception using errcode='22023',message='Invalid access scope';end if;
 v:=case when read_view='auto'then case when r in('owner','admin')then'manage'else'library'end else read_view end;
 if v='manage'and r not in('owner','admin')then raise exception using errcode='42501',message='Management unavailable';end if;
 if target_base is not null then select * into x from public.knowledge_bases where tenant_id=target_tenant and id=target_base;if not found or v='library'and not workforce_private.knowledge_reader(target_tenant,target_base,target_node)then raise exception using errcode='42501',message='Resource unavailable';end if;end if;
 if target_node is not null then select * into n from public.knowledge_nodes where tenant_id=target_tenant and base_id=target_base and id=target_node;if not found then raise exception using errcode='42501',message='Node unavailable';end if;end if;
 return jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',r,'view',v,'timeZone',(select time_zone from public.tenants where id=target_tenant),'catalogVersion',workforce_private.knowledge_catalog_version(target_tenant),'rosterVersion',case when r in('owner','admin')then workforce_private.knowledge_roster_version(target_tenant)else null end,
 'baseRevision',x.revision,'baseStatus',x.status,'audienceVersion',case when x.id is not null then workforce_private.knowledge_audience_version(target_tenant,x.id)else null end,'treeVersion',case when x.id is not null then workforce_private.knowledge_tree_version(target_tenant,x.id)else null end,'eventVersion',case when x.id is not null and r in('owner','admin')then workforce_private.knowledge_event_version(target_tenant,x.id)else null end,'nodeRevision',n.revision,'nodeStatus',n.status,
 'bases',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'revision',revision,'status',status,'audienceVersion',workforce_private.knowledge_audience_version(target_tenant,id))),'[]')from public.knowledge_bases where tenant_id=target_tenant and id=any(target_bases)and(v='manage'or workforce_private.knowledge_reader(target_tenant,id))));
end$$;

-- Distinct read kinds share one coherent statement snapshot, never write view events.
create function public.read_knowledge_base(target_tenant uuid,read_kind text default 'catalog',read_view text default 'auto',target_base uuid default null,target_node uuid default null,parent_node uuid default null,status_filter text default 'all',search_text text default '',page_limit integer default 50,after_item jsonb default null)returns jsonb language plpgsql stable security invoker set search_path=''as $$
declare r text:=workforce_private.membership_role(target_tenant);v text;x public.knowledge_bases;n public.knowledge_nodes;p public.knowledge_nodes;scope jsonb;res jsonb;rows jsonb;counts jsonb;matched bigint;has_more integer;position text;last_id uuid;cv text;av text;tv text;rv text;ev text;tz text;today date;begin
 if r is null then raise exception using errcode='42501',message='Company unavailable';end if;
 if read_kind is null or read_kind not in('catalog','base','children','node','search','assignees','insights')or read_view is null or read_view not in('auto','manage','library')or status_filter is null or status_filter not in('all','draft','published','active','archived')or search_text is null or workforce_private.knowledge_utf16(search_text)>100 or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid knowledge filters';end if;
 if read_kind='catalog'and status_filter not in('all','draft','published','archived')or read_kind in('children','search')and status_filter not in('all','active','archived')or read_kind in('base','node','assignees','insights')and status_filter<>'all'then raise exception using errcode='22023',message='Invalid resource status filter';end if;
 v:=case when read_view='auto'then case when r in('owner','admin')then'manage'else'library'end else read_view end;
 if(v='manage'or read_kind in('assignees','insights'))and r not in('owner','admin')then raise exception using errcode='42501',message='Management unavailable';end if;
 if read_kind in('assignees','insights')then v:='manage';end if;
 if v='library'and status_filter not in('all','published','active')then raise exception using errcode='22023',message='Library only exposes published active resources';end if;
 -- Local acceptance may hold here; all following reads use this statement snapshot.
 select time_zone into tz from public.tenants where id=target_tenant;
 cv:=workforce_private.knowledge_catalog_version(target_tenant);
 if read_kind in('base','children','node','search','insights')then
  select * into x from public.knowledge_bases where tenant_id=target_tenant and id=target_base;if not found or v='library'and not workforce_private.knowledge_reader(target_tenant,target_base)then raise exception using errcode='42501',message='Base unavailable';end if;
  av:=workforce_private.knowledge_audience_version(target_tenant,x.id);tv:=workforce_private.knowledge_tree_version(target_tenant,x.id);
  if target_node is not null then select * into n from public.knowledge_nodes where tenant_id=target_tenant and base_id=target_base and id=target_node;if not found or v='library'and not workforce_private.knowledge_reader(target_tenant,target_base,target_node)then raise exception using errcode='42501',message='Resource unavailable';end if;end if;
  if parent_node is not null then select * into p from public.knowledge_nodes where tenant_id=target_tenant and base_id=target_base and id=parent_node;if not found or p.kind<>'folder'or v='library'and not workforce_private.knowledge_reader(target_tenant,target_base,parent_node)then raise exception using errcode='42501',message='Folder unavailable';end if;end if;
 end if;
 if read_kind='node'and n.id is null then raise exception using errcode='22023',message='Node required';end if;
 if read_kind='assignees'then rv:=workforce_private.knowledge_roster_version(target_tenant);end if;
 if read_kind='insights'then ev:=workforce_private.knowledge_event_version(target_tenant,target_base);end if;
 scope:=jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',r,'view',v,'kind',read_kind,'baseId',target_base,'nodeId',target_node,'parentId',parent_node,'status',status_filter,'search',search_text,'catalogVersion',case when read_kind='catalog'then cv else null end,'baseRevision',x.revision,'audienceVersion',av,'treeVersion',tv,'rosterVersion',rv,'eventVersion',ev,'timeZone',tz);
 if after_item is not null then
  if jsonb_typeof(after_item)is distinct from 'object'or(select array_agg(k order by k)from jsonb_object_keys(after_item)k)is distinct from array['id','position','scope']or jsonb_typeof(after_item->'position')is distinct from 'string'or length(after_item->>'position')>500 or(after_item->>'id')::uuid is null then raise exception using errcode='22023',message='Invalid cursor';end if;
  if after_item->'scope'is distinct from scope then raise exception using errcode='40001',message='Knowledge scope changed';end if;
 end if;
 res:=jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',r,'view',v,'serverTime',statement_timestamp());
 if x.id is not null then res:=res||jsonb_build_object('baseId',x.id,'baseRevision',x.revision,'audienceVersion',av,'treeVersion',tv,'base',workforce_private.knowledge_base_json(target_tenant,x.id));end if;
 if read_kind='catalog'then
  select jsonb_build_object('total',count(*),'draft',count(*)filter(where status='draft'),'published',count(*)filter(where status='published'),'archived',count(*)filter(where status='archived'))into counts from public.knowledge_bases where tenant_id=target_tenant and(v='manage'or workforce_private.knowledge_reader(target_tenant,id))and strpos(lower(name),lower(search_text))>0;
  with page as(select id,lower(name)sort_key from public.knowledge_bases where tenant_id=target_tenant and(v='manage'or workforce_private.knowledge_reader(target_tenant,id))and(status_filter='all'or status=status_filter)and strpos(lower(name),lower(search_text))>0 and(after_item is null or(lower(name),id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(name),id limit page_limit+1)
  select coalesce(jsonb_agg(workforce_private.knowledge_base_json(target_tenant,id)order by sort_key,id)filter(where rn<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where rn=page_limit),(array_agg(id order by rn)filter(where rn=page_limit))[1]into rows,has_more,position,last_id from(select page.*,row_number()over(order by sort_key,id)rn from page)q;
  res:=res||jsonb_build_object('company',(select jsonb_build_object('id',id,'name',name,'time_zone',time_zone)from public.tenants where id=target_tenant),'catalogVersion',cv,'bases',rows,'counts',counts,'capabilities',jsonb_build_object('canManage',r in('owner','admin')));
 elsif read_kind='base'then
  res:=res||jsonb_build_object('company',(select jsonb_build_object('id',id,'name',name,'time_zone',time_zone)from public.tenants where id=target_tenant),'root',jsonb_build_object('activeChildCount',(select count(*)from public.knowledge_nodes where tenant_id=target_tenant and base_id=target_base and parent_id is null and status='active')),'assignees',case when v='manage'then(select coalesce(jsonb_agg(jsonb_build_object('actorId',a.actor_id,'name',a.name,'eligible',e.eligible)order by a.actor_id),'[]')from public.knowledge_audience a join workforce_private.knowledge_eligible(target_tenant)e on e.actor_id=a.actor_id where a.tenant_id=target_tenant and a.base_id=target_base)else'[]'::jsonb end);return res;
 elsif read_kind='node'then
  res:=res||jsonb_build_object('node',workforce_private.knowledge_node_json(n),'path',workforce_private.knowledge_path(target_tenant,target_base,n.parent_id),'body',n.body,'url',n.url);return res;
 elsif read_kind in('children','search')then
  select count(*)into matched from public.knowledge_nodes k where tenant_id=target_tenant and base_id=target_base and(read_kind='search'or parent_id is not distinct from parent_node)and(v='manage'or workforce_private.knowledge_reader(target_tenant,target_base,id))and(status_filter='all'or status=status_filter)and strpos(lower(name),lower(search_text))>0;
  with page as(select k.*,case when read_kind='search'then lower(k.name)else lpad(k.rank::text,20,'0')end sort_key from public.knowledge_nodes k where tenant_id=target_tenant and base_id=target_base and(read_kind='search'or parent_id is not distinct from parent_node)and(v='manage'or workforce_private.knowledge_reader(target_tenant,target_base,id))and(status_filter='all'or status=status_filter)and strpos(lower(name),lower(search_text))>0 and(after_item is null or(case when read_kind='search'then lower(k.name)else lpad(k.rank::text,20,'0')end,k.id)>(after_item->>'position',(after_item->>'id')::uuid))order by sort_key,k.id limit page_limit+1)
  select coalesce(jsonb_agg(case when read_kind='search'then jsonb_build_object('node',workforce_private.knowledge_node_json(row(q.id,q.tenant_id,q.base_id,q.parent_id,q.kind,q.name,q.description,q.body,q.url,q.status,q.revision,q.depth,q.rank)::public.knowledge_nodes),'path',workforce_private.knowledge_path(target_tenant,target_base,q.parent_id))else workforce_private.knowledge_node_json(row(q.id,q.tenant_id,q.base_id,q.parent_id,q.kind,q.name,q.description,q.body,q.url,q.status,q.revision,q.depth,q.rank)::public.knowledge_nodes)end order by sort_key,id)filter(where rn<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where rn=page_limit),(array_agg(id order by rn)filter(where rn=page_limit))[1]into rows,has_more,position,last_id from(select page.*,row_number()over(order by sort_key,id)rn from page)q;
  if read_kind='children'then res:=res||jsonb_build_object('parent',case when p.id is not null then workforce_private.knowledge_node_json(p)else null end,'path',workforce_private.knowledge_path(target_tenant,target_base,parent_node),'nodes',rows,'matchedCount',matched);else res:=res||jsonb_build_object('results',rows,'matchedCount',matched);end if;
 elsif read_kind='assignees'then
  select count(*)into matched from public.tenant_memberships m join workforce_private.knowledge_eligible(target_tenant)e on e.actor_id=m.user_id where m.tenant_id=target_tenant and e.eligible and strpos(lower(m.display_name),lower(search_text))>0;
  with page as(select m.user_id id,m.display_name,lower(m.display_name)sort_key from public.tenant_memberships m join workforce_private.knowledge_eligible(target_tenant)e on e.actor_id=m.user_id where m.tenant_id=target_tenant and e.eligible and strpos(lower(m.display_name),lower(search_text))>0 and(after_item is null or(lower(m.display_name),m.user_id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(m.display_name),m.user_id limit page_limit+1)
  select coalesce(jsonb_agg(jsonb_build_object('actorId',id,'name',display_name,'eligible',true)order by sort_key,id)filter(where rn<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where rn=page_limit),(array_agg(id order by rn)filter(where rn=page_limit))[1]into rows,has_more,position,last_id from(select page.*,row_number()over(order by sort_key,id)rn from page)q;
  res:=res||jsonb_build_object('rosterVersion',rv,'users',rows,'matchedCount',matched);
 elsif read_kind='insights'then
  today:=(statement_timestamp()at time zone tz)::date;
  with assigned as(select a.actor_id,e.eligible from public.knowledge_audience a join workforce_private.knowledge_eligible(target_tenant)e on e.actor_id=a.actor_id where a.tenant_id=target_tenant and a.base_id=target_base),events as(select e.*from public.knowledge_events e join assigned a on a.actor_id=e.actor_id where e.tenant_id=target_tenant and e.base_id=target_base and(target_node is null or e.node_id=target_node))
  select jsonb_build_object('assigned',(select count(*)from assigned),'eligible',(select count(*)from assigned where eligible),'unavailable',(select count(*)from assigned where not eligible),'distinctEligibleViewers',(select count(distinct e.actor_id)from events e join assigned a on a.actor_id=e.actor_id where a.eligible),'eligibleViewedPercentage',case when(select count(*)from assigned where eligible)=0 then null else 100.0*(select count(distinct e.actor_id)from events e join assigned a on a.actor_id=e.actor_id where a.eligible)/(select count(*)from assigned where eligible)end,'totalViews',(select count(*)::text from events))into counts;
  select count(*)into matched from public.knowledge_audience where tenant_id=target_tenant and base_id=target_base and strpos(lower(name),lower(search_text))>0;
  with page as(select a.actor_id id,a.name,e.eligible,lower(a.name)sort_key from public.knowledge_audience a join workforce_private.knowledge_eligible(target_tenant)e on e.actor_id=a.actor_id where a.tenant_id=target_tenant and a.base_id=target_base and strpos(lower(a.name),lower(search_text))>0 and(after_item is null or(lower(a.name),a.actor_id)>(after_item->>'position',(after_item->>'id')::uuid))order by lower(a.name),a.actor_id limit page_limit+1)
  select coalesce(jsonb_agg(jsonb_build_object('actorId',id,'name',name,'eligible',eligible,'totalViews',(select count(*)::text from public.knowledge_events where tenant_id=target_tenant and base_id=target_base and actor_id=q.id and(target_node is null or node_id=target_node)),'lastViewedAt',(select max(occurred_at)from public.knowledge_events where tenant_id=target_tenant and base_id=target_base and actor_id=q.id and(target_node is null or node_id=target_node)))order by sort_key,id)filter(where rn<=page_limit),'[]'),(count(*)>page_limit)::integer,max(sort_key)filter(where rn=page_limit),(array_agg(id order by rn)filter(where rn=page_limit))[1]into rows,has_more,position,last_id from(select page.*,row_number()over(order by sort_key,id)rn from page)q;
  res:=res||jsonb_build_object('node',case when n.id is not null then workforce_private.knowledge_node_json(n)else null end,'path',workforce_private.knowledge_path(target_tenant,target_base,n.parent_id),'eventVersion',ev,'timeZone',tz,'counts',counts,'users',rows,'matchedCount',matched,
  'chart',(select jsonb_agg(jsonb_build_object('date',d::date,'views',(select count(*)::text from public.knowledge_events e join public.knowledge_audience a on a.tenant_id=e.tenant_id and a.base_id=e.base_id and a.actor_id=e.actor_id where e.tenant_id=target_tenant and e.base_id=target_base and(target_node is null or e.node_id=target_node)and(e.occurred_at at time zone tz)::date=d::date))order by d)from generate_series(today-29,today,'1 day')d));
 end if;
 return res||jsonb_build_object('nextCursor',case when has_more>0 then jsonb_build_object('scope',scope,'id',last_id,'position',position)else null end);
end$$;
-- Hosted defaults may independently grant every public function to service_role.
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='workforce_private'and(p.proname like 'knowledge_%'or p.proname in('save_knowledge_base','reconcile_knowledge_view'))or n.nspname='public'and p.proname in('save_knowledge_base','reconcile_knowledge_view','read_knowledge_base','read_knowledge_base_access')loop
  execute format('revoke all on function %s from public,anon,authenticated,service_role',f.signature);execute format('grant execute on function %s to authenticated',f.signature);
 end loop;
end$$;
commit;
