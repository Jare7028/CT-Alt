begin;
-- Fixed Auth-user audiences. Published text and audience are immutable.
create table public.updates_posts (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
 title text not null check(length(btrim(title)) between 1 and 160),body text not null check(length(btrim(body)) between 1 and 5000),
 status text not null default 'draft' check(status in('draft','published','archived')),
 revision integer not null default 1 check(revision>0),content_revision integer not null default 0 check(content_revision in(0,1)),
 allow_comments boolean not null,allow_reactions boolean not null,require_confirmation boolean not null,
 created_by uuid not null,created_name text not null,created_at timestamptz not null default clock_timestamp(),published_at timestamptz,
 unique(tenant_id,id),foreign key(tenant_id,created_by) references public.tenant_memberships(tenant_id,user_id),
 check((status='draft' and published_at is null and content_revision=0) or (status<>'draft' and published_at is not null and content_revision=1))
);
create index updates_posts_page on public.updates_posts(tenant_id,created_at desc,id desc);
create table public.updates_recipients (
 tenant_id uuid not null,post_id uuid not null,actor_id uuid not null,name text not null,
 viewed_at timestamptz,confirmed_at timestamptz,liked boolean not null default false,
 primary key(tenant_id,post_id,actor_id),foreign key(tenant_id,post_id) references public.updates_posts(tenant_id,id),
 foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id),check(confirmed_at is null or viewed_at is not null)
);
create index updates_recipient_feed on public.updates_recipients(tenant_id,actor_id,post_id);
create table public.updates_comments (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,post_id uuid not null,actor_id uuid not null,author_name text not null,
 body text not null check(length(body)<=2000),status text not null default 'active' check(status in('active','removed')),revision integer not null default 1 check(revision>0),
 created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,post_id,actor_id) references public.updates_recipients(tenant_id,post_id,actor_id),unique(tenant_id,post_id,id),
 check((status='active' and length(btrim(body))>0) or(status='removed' and body=''))
);
create index updates_comments_page on public.updates_comments(tenant_id,post_id,created_at desc,id desc);
create table public.updates_audit (
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,post_id uuid not null,actor_id uuid not null,actor_name text not null,
 action text not null check(action in('create','edit','publish','archive','restore','view','confirm','like','unlike','comment','edit_comment','remove_comment')),
 revision integer not null,comment_id uuid,occurred_at timestamptz not null default clock_timestamp(),
 foreign key(tenant_id,post_id) references public.updates_posts(tenant_id,id),foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id)
);
create table workforce_private.updates_operations (
 tenant_id uuid not null,actor_id uuid not null,operation_id uuid not null,payload jsonb not null,result jsonb not null,
 primary key(tenant_id,actor_id,operation_id),foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table workforce_private.updates_operations enable row level security;
revoke all on workforce_private.updates_operations from public,anon,authenticated,service_role;

create function workforce_private.updates_access(t uuid,p uuid) returns boolean language sql stable security definer set search_path='' as $$
 select workforce_private.membership_role(t) is not null and exists(select 1 from public.updates_posts x where x.tenant_id=t and x.id=p and
 (workforce_private.membership_role(t) in('owner','admin') or (x.status='published' and exists(select 1 from public.updates_recipients r where r.tenant_id=t and r.post_id=p and r.actor_id=(select auth.uid())))))
$$;
create function workforce_private.updates_post_json(t uuid,p uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare x public.updates_posts;r public.updates_recipients;admin boolean;personal boolean;begin
 if not workforce_private.updates_access(t,p) then raise exception using errcode='42501',message='Update unavailable';end if;
 select * into x from public.updates_posts where tenant_id=t and id=p;
 select * into r from public.updates_recipients where tenant_id=t and post_id=p and actor_id=(select auth.uid());personal:=found;
 admin:=workforce_private.membership_role(t) in('owner','admin');
 return jsonb_build_object('id',x.id,'tenant_id',t,'title',x.title,'body',x.body,'status',x.status,'revision',x.revision,'content_revision',x.content_revision,
 'created_by',x.created_by,'created_name',x.created_name,'created_at',x.created_at,'published_at',x.published_at,
 'allowComments',x.allow_comments,'allowReactions',x.allow_reactions,'requireConfirmation',x.require_confirmation,
 'recipientCount',(select count(*) from public.updates_recipients where tenant_id=t and post_id=p),
 'viewedCount',(select count(*) from public.updates_recipients where tenant_id=t and post_id=p and viewed_at is not null),
 'confirmedCount',(select count(*) from public.updates_recipients where tenant_id=t and post_id=p and confirmed_at is not null),
 'likeCount',(select count(*) from public.updates_recipients where tenant_id=t and post_id=p and liked),
 'commentCount',(select count(*) from public.updates_comments where tenant_id=t and post_id=p and status='active'),
 'liked',coalesce(r.liked,false),'viewedAt',r.viewed_at,'confirmedAt',r.confirmed_at,'isRecipient',personal,
 'canEngage',personal and x.status='published','canEdit',admin and x.status='draft','canPublish',admin and x.status='draft','canArchive',admin and x.status='published','canRestore',admin and x.status='archived');
end $$;
create function workforce_private.updates_comment_json(c public.updates_comments) returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('id',c.id,'post_id',c.post_id,'actorId',c.actor_id,'author_name',c.author_name,'body',c.body,'status',c.status,'revision',c.revision,'created_at',c.created_at,'updated_at',c.updated_at,
 'canEdit',c.status='active' and c.actor_id=(select auth.uid()) and p.status='published' and p.allow_comments and exists(select 1 from public.updates_recipients r where r.tenant_id=c.tenant_id and r.post_id=c.post_id and r.actor_id=(select auth.uid())),
 'canRemove',c.status='active' and c.actor_id=(select auth.uid()) and p.status='published' and p.allow_comments and exists(select 1 from public.updates_recipients r where r.tenant_id=c.tenant_id and r.post_id=c.post_id and r.actor_id=(select auth.uid())))
 from public.updates_posts p where p.tenant_id=c.tenant_id and p.id=c.post_id
$$;
alter table public.updates_posts enable row level security;
alter table public.updates_recipients enable row level security;
alter table public.updates_comments enable row level security;
alter table public.updates_audit enable row level security;
revoke all on public.updates_posts,public.updates_recipients,public.updates_comments,public.updates_audit from public,anon,authenticated,service_role;
grant select on public.updates_posts,public.updates_recipients,public.updates_comments,public.updates_audit to authenticated;
create policy updates_posts_read on public.updates_posts for select to authenticated using(workforce_private.updates_access(tenant_id,id));
create policy updates_recipients_read on public.updates_recipients for select to authenticated using(workforce_private.updates_access(tenant_id,post_id) and (actor_id=(select auth.uid()) or workforce_private.membership_role(tenant_id) in('owner','admin')));
create policy updates_comments_read on public.updates_comments for select to authenticated using(workforce_private.updates_access(tenant_id,post_id));
create policy updates_audit_read on public.updates_audit for select to authenticated using(workforce_private.membership_role(tenant_id) in('owner','admin'));

create function workforce_private.save_update(t uuid,op uuid,change jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=(select auth.uid());role_name text;actor_name text;a text:=change->>'action';x public.updates_posts;personal_rec public.updates_recipients;c public.updates_comments;receipt workforce_private.updates_operations;
 ids uuid[];keys text[];pid uuid;cid uuid;res jsonb;begin
 if t is null or op is null or jsonb_typeof(change)<>'object' or a is null then raise exception using errcode='22023',message='Invalid update';end if;
 -- Lock current identity rows before authorization; lifetime covers all mutations/replays.
 perform 1 from public.tenants where id=t for share;
 perform 1 from auth.users where id=actor for share;
 select m.display_name into actor_name from public.tenant_memberships m where m.tenant_id=t and m.user_id=actor for share;
 role_name:=workforce_private.membership_role(t);if role_name is null then raise exception using errcode='42501',message='Company unavailable';end if;
 if a in('create','edit','publish','archive','restore') then
  if role_name not in('owner','admin') then raise exception using errcode='42501',message='Management unavailable';end if;
 else
  if a not in('view','confirm','like','unlike','comment','edit_comment','remove_comment') then raise exception using errcode='22023',message='Invalid action';end if;
 end if;
 keys:=case a when 'create' then array['action','title','body','recipientIds','allowComments','allowReactions','requireConfirmation'] when 'edit' then array['action','postId','revision','title','body','recipientIds','allowComments','allowReactions','requireConfirmation']
 when 'publish' then array['action','postId','revision'] when 'archive' then array['action','postId','revision'] when 'restore' then array['action','postId','revision']
 when 'comment' then array['action','postId','contentRevision','body'] when 'edit_comment' then array['action','postId','contentRevision','commentId','revision','body'] when 'remove_comment' then array['action','postId','contentRevision','commentId','revision'] else array['action','postId','contentRevision'] end;
 if (select array_agg(k order by k) from jsonb_object_keys(change) k) is distinct from (select array_agg(k order by k) from unnest(keys) k) then raise exception using errcode='22023',message='Invalid fields';end if;
 if exists(select 1 from jsonb_each(change) where value='null'::jsonb) or jsonb_typeof(change->'action')<>'string' then raise exception using errcode='22023',message='Missing value';end if;
 if change ? 'revision' and (jsonb_typeof(change->'revision')<>'number' or (change->>'revision')!~'^[1-9][0-9]{0,9}$' or (change->>'revision')::numeric>2147483646) or change ? 'contentRevision' and change->'contentRevision'<>'1'::jsonb then raise exception using errcode='22023',message='Invalid revision';end if;
 if a<>'create' then
  pid:=(change->>'postId')::uuid;select * into x from public.updates_posts where tenant_id=t and id=pid for update;
  if not found then raise exception using errcode='42501',message='Update unavailable';end if;
  if a not in('edit','publish','archive','restore') then
   select * into personal_rec from public.updates_recipients where tenant_id=t and post_id=pid and actor_id=actor for update;
   if not found or x.status<>'published' then raise exception using errcode='42501',message='Recipient update unavailable';end if;
   if (change->>'contentRevision')::integer<>x.content_revision then raise exception using errcode='40001',message='Content changed';end if;
   if a in('like','unlike') and not x.allow_reactions or a in('comment','edit_comment','remove_comment') and not x.allow_comments or a='confirm' and not x.require_confirmation then raise exception using errcode='42501',message='Engagement unavailable';end if;
   if a in('edit_comment','remove_comment') then
    select * into c from public.updates_comments where tenant_id=t and post_id=pid and id=(change->>'commentId')::uuid;
    if not found or c.actor_id<>actor then raise exception using errcode='42501',message='Comment unavailable';end if;
   end if;
  end if;
 end if;
 -- Actor-scoped operation serialization also protects create receipts, which have no post yet.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(t::text||actor::text||op::text,19));
 select * into receipt from workforce_private.updates_operations where tenant_id=t and actor_id=actor and operation_id=op;
 if found then if receipt.payload<>change then raise exception using errcode='40001',message='Retry payload changed';end if;return receipt.result;end if;
 if a in('create','edit') then
  if jsonb_typeof(change->'title')<>'string' or length(btrim(change->>'title')) not between 1 and 160 or jsonb_typeof(change->'body')<>'string' or length(btrim(change->>'body')) not between 1 and 5000
   or jsonb_typeof(change->'allowComments')<>'boolean' or jsonb_typeof(change->'allowReactions')<>'boolean' or jsonb_typeof(change->'requireConfirmation')<>'boolean'
   or jsonb_typeof(change->'recipientIds')<>'array' or jsonb_array_length(change->'recipientIds') not between 1 and 500 then raise exception using errcode='22023',message='Invalid draft';end if;
  if exists(select 1 from jsonb_array_elements(change->'recipientIds') v where jsonb_typeof(v)<>'string') then raise exception using errcode='22023',message='Invalid audience';end if;
  select array_agg(v::uuid order by v::uuid) into ids from jsonb_array_elements_text(change->'recipientIds') v;
  if cardinality(ids)<>(select count(distinct v) from unnest(ids) v) then raise exception using errcode='22023',message='Duplicate recipients';end if;
  perform 1 from public.tenant_memberships m where m.tenant_id=t and m.user_id=any(ids) order by m.user_id for share;
  perform 1 from auth.users u where u.id=any(ids) order by u.id for share;
  if cardinality(ids)<>(select count(*) from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.user_id=any(ids) and m.status='active' and u.email_confirmed_at is not null and not u.is_anonymous) then raise exception using errcode='42501',message='Selected recipient unavailable';end if;
  if a='create' then
   insert into public.updates_posts(tenant_id,title,body,allow_comments,allow_reactions,require_confirmation,created_by,created_name) values(t,btrim(change->>'title'),btrim(change->>'body'),(change->>'allowComments')::boolean,(change->>'allowReactions')::boolean,(change->>'requireConfirmation')::boolean,actor,actor_name) returning * into x;pid:=x.id;
  else
   if x.status<>'draft' or (change->>'revision')::integer<>x.revision then raise exception using errcode='40001',message='Draft changed';end if;
   update public.updates_posts set title=btrim(change->>'title'),body=btrim(change->>'body'),allow_comments=(change->>'allowComments')::boolean,allow_reactions=(change->>'allowReactions')::boolean,require_confirmation=(change->>'requireConfirmation')::boolean,revision=revision+1 where id=pid returning * into x;
   delete from public.updates_recipients where tenant_id=t and post_id=pid;
  end if;
  insert into public.updates_recipients(tenant_id,post_id,actor_id,name) select t,pid,m.user_id,m.display_name from public.tenant_memberships m where m.tenant_id=t and m.user_id=any(ids);
 elsif a in('publish','archive','restore') then
  if (change->>'revision')::integer<>x.revision or (a='publish' and x.status<>'draft') or(a='archive' and x.status<>'published') or(a='restore' and x.status<>'archived') then raise exception using errcode='40001',message='Update changed';end if;
  if a='publish' then
   perform 1 from public.tenant_memberships m join public.updates_recipients r on r.tenant_id=m.tenant_id and r.actor_id=m.user_id where r.tenant_id=t and r.post_id=pid order by m.user_id for share of m;
   perform 1 from auth.users u join public.updates_recipients r on r.actor_id=u.id where r.tenant_id=t and r.post_id=pid order by u.id for share of u;
   if exists(select 1 from public.updates_recipients r join public.tenant_memberships m on m.tenant_id=r.tenant_id and m.user_id=r.actor_id join auth.users u on u.id=r.actor_id where r.tenant_id=t and r.post_id=pid and (m.status<>'active' or u.email_confirmed_at is null or u.is_anonymous)) then raise exception using errcode='42501',message='Selected recipient unavailable';end if;
  end if;
  update public.updates_posts set status=case when a='archive' then 'archived' else 'published' end,revision=revision+1,content_revision=1,published_at=coalesce(published_at,clock_timestamp()) where id=pid returning * into x;
 elsif a in('view','confirm','like','unlike') then
  update public.updates_recipients set viewed_at=case when a in('view','confirm') then coalesce(viewed_at,clock_timestamp()) else viewed_at end,confirmed_at=case when a='confirm' then coalesce(confirmed_at,clock_timestamp()) else confirmed_at end,liked=case when a='like' then true when a='unlike' then false else liked end where tenant_id=t and post_id=pid and actor_id=actor;
 elsif a='comment' then
  if jsonb_typeof(change->'body')<>'string' or length(btrim(change->>'body')) not between 1 and 2000 then raise exception using errcode='22023',message='Invalid comment';end if;
  insert into public.updates_comments(tenant_id,post_id,actor_id,author_name,body) values(t,pid,actor,actor_name,btrim(change->>'body')) returning * into c;cid:=c.id;
 else
  if c.status<>'active' or (change->>'revision')::integer<>c.revision then raise exception using errcode='40001',message='Comment changed';end if;
  if a='edit_comment' and(jsonb_typeof(change->'body')<>'string' or length(btrim(change->>'body')) not between 1 and 2000) then raise exception using errcode='22023',message='Invalid comment';end if;
  update public.updates_comments set body=case when a='remove_comment' then '' else btrim(change->>'body') end,status=case when a='remove_comment' then 'removed' else 'active' end,revision=revision+1,updated_at=clock_timestamp() where id=c.id returning * into c;cid:=c.id;
 end if;
 res:=jsonb_build_object('operationId',op,'action',a,'postId',pid,'revision',x.revision,'contentRevision',x.content_revision);
 if a in('comment','edit_comment','remove_comment') then res:=res||jsonb_build_object('commentId',c.id,'commentRevision',c.revision);end if;
 insert into public.updates_audit(tenant_id,post_id,actor_id,actor_name,action,revision,comment_id) values(t,pid,actor,actor_name,a,x.revision,cid);
 insert into workforce_private.updates_operations values(t,actor,op,change,res);return res;
end $$;
create function public.save_update(target_tenant uuid,operation_id uuid,change jsonb) returns jsonb language sql security invoker set search_path='' as $$select workforce_private.save_update(target_tenant,operation_id,change)$$;

create function public.read_updates_access(target_tenant uuid,target_post uuid default null,target_posts uuid[] default '{}'::uuid[]) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r text:=workforce_private.membership_role(target_tenant);x public.updates_posts;begin
 if r is null then raise exception using errcode='42501',message='Company unavailable';end if;
 if target_posts is null or cardinality(target_posts)>100 then raise exception using errcode='22023',message='Invalid access query';end if;
 if target_post is not null then select * into x from public.updates_posts where tenant_id=target_tenant and id=target_post;if not found then raise exception using errcode='42501',message='Update unavailable';end if;end if;
 return jsonb_build_object('actorId',(select auth.uid()),'role',r,'postStatus',x.status,'contentRevision',x.content_revision,'postRevision',x.revision,'isRecipient',exists(select 1 from public.updates_recipients where tenant_id=target_tenant and post_id=target_post and actor_id=(select auth.uid())),
 'posts',(select coalesce(jsonb_agg(jsonb_build_object('id',p.id,'status',p.status,'revision',p.revision,'contentRevision',p.content_revision,'isRecipient',exists(select 1 from public.updates_recipients r where r.tenant_id=target_tenant and r.post_id=p.id and r.actor_id=(select auth.uid())))),'[]') from public.updates_posts p where p.tenant_id=target_tenant and p.id=any(target_posts)));
end $$;

-- One invoker snapshot supplies exact counts and one bounded page. All cursor
-- positions include explicit actor/tenant/filter scopes, never caller authority.
create function workforce_private.updates_roster(t uuid) returns table(user_id uuid,display_name text) language plpgsql stable security definer set search_path='' as $$begin
 if workforce_private.membership_role(t) not in('owner','admin') or workforce_private.membership_role(t) is null then raise exception using errcode='42501',message='Management unavailable';end if;
 return query select m.user_id,m.display_name from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.status='active' and u.email_confirmed_at is not null and not u.is_anonymous;
end $$;
create function public.read_updates(target_tenant uuid,read_kind text default 'feed',target_post uuid default null,status_filter text default 'all',search_text text default '',page_limit integer default 50,after_item jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=(select auth.uid());r text:=workforce_private.membership_role(target_tenant);scope jsonb;items jsonb;counts jsonb;next_pos jsonb;company jsonb;access jsonb;begin
 if r is null then raise exception using errcode='42501',message='Company unavailable';end if;
 if read_kind is null or page_limit is null or read_kind not in('feed','manage','detail','roster','recipients') or page_limit not between 1 and 100 or length(search_text)>100 or search_text is null or status_filter is null then raise exception using errcode='22023',message='Invalid query';end if;
 if read_kind in('manage','roster','recipients') and r not in('owner','admin') then raise exception using errcode='42501',message='Management unavailable';end if;
 if read_kind in('detail','recipients') then access:=public.read_updates_access(target_tenant,target_post);end if;
 if read_kind in('feed','manage') and status_filter not in('all','draft','published','archived') or read_kind='recipients' and status_filter not in('all','viewed','unviewed','confirmed','unconfirmed') or read_kind in('roster','detail') and status_filter<>'all' then raise exception using errcode='22023',message='Invalid status';end if;
 scope:=jsonb_build_object('tenantId',target_tenant,'actorId',actor,'role',r,'kind',read_kind,'postId',target_post,'status',status_filter,'search',search_text,'contentRevision',access->'contentRevision','postRevision',access->'postRevision');
 if after_item is not null and (jsonb_typeof(after_item)<>'object' or after_item->'scope' is distinct from scope or not(after_item ? 'id') or (select count(*) from jsonb_object_keys(after_item))<>3 or not(after_item ? 'position')) then raise exception using errcode='22023',message='Cursor changed';end if;
 select jsonb_build_object('id',id,'name',name,'time_zone',time_zone) into company from public.tenants where id=target_tenant;
 if read_kind in('feed','manage') then
  with filtered as(select p.* from public.updates_posts p where p.tenant_id=target_tenant and position(lower(search_text) in lower(p.title))>0 and(read_kind='manage' or (p.status='published' and exists(select 1 from public.updates_recipients u where u.tenant_id=target_tenant and u.post_id=p.id and u.actor_id=actor))))
  select jsonb_build_object('total',count(*),'draft',count(*)filter(where status='draft'),'published',count(*)filter(where status='published'),'archived',count(*)filter(where status='archived')) into counts from filtered;
  with filtered as(select p.*,case when read_kind='feed' then p.published_at else p.created_at end as page_at from public.updates_posts p where p.tenant_id=target_tenant and position(lower(search_text) in lower(p.title))>0 and(status_filter='all' or p.status=status_filter) and(read_kind='manage' or (p.status='published' and exists(select 1 from public.updates_recipients u where u.tenant_id=target_tenant and u.post_id=p.id and u.actor_id=actor)))),
  page as(select * from filtered where after_item is null or(page_at,id)<((after_item->>'position')::timestamptz,(after_item->>'id')::uuid) order by page_at desc,id desc limit page_limit+1),numbered as(select *,row_number()over(order by page_at desc,id desc)n from page)
  select coalesce(jsonb_agg(workforce_private.updates_post_json(target_tenant,id) order by page_at desc,id desc)filter(where n<=page_limit),'[]'),case when count(*)>page_limit then (jsonb_agg(jsonb_build_object('scope',scope,'id',id,'position',to_char(page_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by page_at desc,id desc)->(page_limit-1)) else null end into items,next_pos from numbered;
  return jsonb_build_object('company',company,'role',r,'actorId',actor,'capabilities',jsonb_build_object('canManage',r in('owner','admin')),'posts',items,'counts',counts,'nextCursor',next_pos,'serverTime',statement_timestamp());
 elsif read_kind='roster' then
  with filtered as(select m.user_id,m.display_name from workforce_private.updates_roster(target_tenant) m where position(lower(search_text) in lower(m.display_name))>0),
  page as(select * from filtered where after_item is null or(lower(display_name),user_id)>((after_item->>'position'),(after_item->>'id')::uuid) order by lower(display_name),user_id limit page_limit+1),numbered as(select *,row_number()over(order by lower(display_name),user_id)n from page)
  select coalesce(jsonb_agg(jsonb_build_object('id',user_id,'name',display_name) order by lower(display_name),user_id)filter(where n<=page_limit),'[]'),case when count(*)>page_limit then(jsonb_agg(jsonb_build_object('scope',scope,'id',user_id,'position',lower(display_name)) order by lower(display_name),user_id)->(page_limit-1))else null end into items,next_pos from numbered;
  return jsonb_build_object('tenantId',target_tenant,'actorId',actor,'role',r,'users',items,'nextCursor',next_pos);
 elsif read_kind='recipients' then
  select jsonb_build_object('total',count(*),'viewed',count(*)filter(where viewed_at is not null),'confirmed',count(*)filter(where confirmed_at is not null),'likes',count(*)filter(where liked),'comments',(select count(*)from public.updates_comments where tenant_id=target_tenant and post_id=target_post and status='active'))into counts from public.updates_recipients where tenant_id=target_tenant and post_id=target_post;
  with page as(select * from public.updates_recipients where tenant_id=target_tenant and post_id=target_post and(case status_filter when 'viewed' then viewed_at is not null when 'unviewed' then viewed_at is null when 'confirmed' then confirmed_at is not null when 'unconfirmed' then confirmed_at is null else true end) and(after_item is null or actor_id>(after_item->>'id')::uuid) order by actor_id limit page_limit+1),numbered as(select *,row_number()over(order by actor_id)n from page)
  select coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'name',name,'viewedAt',viewed_at,'confirmedAt',confirmed_at) order by actor_id)filter(where n<=page_limit),'[]'),case when count(*)>page_limit then(jsonb_agg(jsonb_build_object('scope',scope,'id',actor_id,'position','') order by actor_id)->(page_limit-1))else null end into items,next_pos from numbered;
  return jsonb_build_object('tenantId',target_tenant,'actorId',actor,'role',r,'recipients',items,'counts',counts,'nextCursor',next_pos);
 else
  with page as(select * from public.updates_comments where tenant_id=target_tenant and post_id=target_post and(after_item is null or(created_at,id)<((after_item->>'position')::timestamptz,(after_item->>'id')::uuid)) order by created_at desc,id desc limit page_limit+1),numbered as(select *,row_number()over(order by created_at desc,id desc)n from page)
  select coalesce(jsonb_agg(workforce_private.updates_comment_json((select c from public.updates_comments c where c.id=numbered.id)) order by created_at desc,id desc)filter(where n<=page_limit),'[]'),case when count(*)>page_limit then(jsonb_agg(jsonb_build_object('scope',scope,'id',id,'position',to_char(created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')) order by created_at desc,id desc)->(page_limit-1))else null end into items,next_pos from numbered;
  return jsonb_build_object('tenantId',target_tenant,'actorId',actor,'role',r,'post',workforce_private.updates_post_json(target_tenant,target_post),'recipients',case when r in('owner','admin')then(select coalesce(jsonb_agg(jsonb_build_object('id',actor_id,'name',name) order by actor_id),'[]')from public.updates_recipients where tenant_id=target_tenant and post_id=target_post)else '[]'::jsonb end,'comments',items,'nextCommentsCursor',next_pos,'serverTime',statement_timestamp());
 end if;
end $$;
-- Explicitly neutralize permissive hosted default EXECUTE grants.
revoke all on function workforce_private.updates_roster(uuid),workforce_private.updates_access(uuid,uuid),workforce_private.updates_post_json(uuid,uuid),workforce_private.updates_comment_json(public.updates_comments),workforce_private.save_update(uuid,uuid,jsonb),public.save_update(uuid,uuid,jsonb),public.read_updates_access(uuid,uuid,uuid[]),public.read_updates(uuid,text,uuid,text,text,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function workforce_private.updates_roster(uuid),workforce_private.updates_access(uuid,uuid),workforce_private.updates_post_json(uuid,uuid),workforce_private.updates_comment_json(public.updates_comments),workforce_private.save_update(uuid,uuid,jsonb),public.save_update(uuid,uuid,jsonb),public.read_updates_access(uuid,uuid,uuid[]),public.read_updates(uuid,text,uuid,text,text,integer,jsonb) to authenticated;
commit;
