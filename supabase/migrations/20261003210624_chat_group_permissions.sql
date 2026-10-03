begin;
alter table public.chat_members add column group_admin boolean not null default false;
alter table public.chat_conversations add column allow_member_messages boolean not null default true,
 add column settings_revision integer not null default 1 check(settings_revision>0),
 add constraint chat_direct_posting check(kind='group' or allow_member_messages);

create function chat_private.group_manager(t uuid,c uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select chat_private.allowed(t,c) and exists(
  select 1 from public.chat_members m join public.chat_conversations v on v.id=m.conversation_id and v.tenant_id=m.tenant_id
  where m.tenant_id=t and m.conversation_id=c and m.user_id=auth.uid() and v.kind='group'
   and (m.group_admin or workforce_private.membership_role(t) in ('owner','admin')))
$$;
revoke all on function chat_private.group_manager(uuid,uuid) from public,anon,authenticated;
grant execute on function chat_private.group_manager(uuid,uuid) to authenticated;

create table public.chat_group_audit (
 tenant_id uuid not null, conversation_id uuid not null, revision integer not null,
 actor_id uuid not null, member_ids uuid[] not null, group_admin_ids uuid[] not null,
 allow_member_messages boolean not null, occurred_at timestamptz not null default clock_timestamp(),
 primary key(conversation_id,revision),
 foreign key(tenant_id,conversation_id) references public.chat_conversations(tenant_id,id) on delete cascade,
 foreign key(tenant_id,actor_id) references public.tenant_memberships(tenant_id,user_id)
);
alter table public.chat_group_audit enable row level security;
revoke all on public.chat_group_audit from public,anon,authenticated;
grant select on public.chat_group_audit to authenticated;
grant all on public.chat_group_audit to service_role;
create policy chat_group_audit_read on public.chat_group_audit for select to authenticated
 using(chat_private.group_manager(tenant_id,conversation_id));

-- Old core remains an internal implementation detail. Revocation prevents
-- direct invocation from bypassing the new send/management gates.
revoke all on function chat_private.act(uuid,jsonb) from public,anon,authenticated;
create function chat_private.group_action(t uuid,p jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
 actor uuid:=auth.uid(); actor_role text; action text:=p->>'action'; c uuid;
 v public.chat_conversations%rowtype; result jsonb; item jsonb; members uuid[]; admins uuid[];
 expected_revision integer; allow_messages boolean; member_count integer;
begin
 if p is null or jsonb_typeof(p)<>'object' or octet_length(p::text)>24000 then raise exception using errcode='22023',message='Invalid chat request'; end if;
 perform 1 from public.tenants where id=t and status='active' for share;
 if not found then raise exception using errcode='42501',message='Company access unavailable'; end if;
 select role into actor_role from public.tenant_memberships where tenant_id=t and user_id=actor and status='active' for share;
 if actor_role is null or workforce_private.membership_role(t) is null then raise exception using errcode='42501',message='Chat access unavailable'; end if;
 if action='create' then
  if p ? 'allow_member_messages' and jsonb_typeof(p->'allow_member_messages')<>'boolean' then raise exception using errcode='22023',message='Choose who can post'; end if;
  allow_messages:=coalesce((p->>'allow_member_messages')::boolean,true);
  if p->>'kind'='direct' and not allow_messages then raise exception using errcode='22023',message='Direct chats allow both participants to post'; end if;
  result:=chat_private.act(t,p-'allow_member_messages'); c:=(result->>'id')::uuid;
  if p->>'kind'='group' then
   update public.chat_members set group_admin=true where tenant_id=t and conversation_id=c and user_id=actor;
   update public.chat_conversations set allow_member_messages=allow_messages where tenant_id=t and id=c;
  end if;
  return result;
 elsif action='list' then
  result:=chat_private.act(t,p);
  return coalesce((select jsonb_agg(entry.value || jsonb_build_object(
   'allow_member_messages',cv.allow_member_messages,'settings_revision',cv.settings_revision,
   'can_manage',chat_private.group_manager(t,cv.id),
   'can_post',chat_private.allowed(t,cv.id) and (cv.kind='direct' or cv.allow_member_messages or chat_private.group_manager(t,cv.id))) order by entry.ordinality)
   from jsonb_array_elements(result) with ordinality entry(value,ordinality)
   join public.chat_conversations cv on cv.tenant_id=t and cv.id=(entry.value->>'id')::uuid),'[]'::jsonb);
 elsif action not in ('send','group_info','manage_group') or action is null then
  return chat_private.act(t,p);
 end if;
 c:=(p->>'conversationId')::uuid;
 select * into v from public.chat_conversations where tenant_id=t and id=c for update;
 if not found or not chat_private.allowed(t,c) then raise exception using errcode='42501',message='Chat unavailable'; end if;
 perform 1 from public.chat_members where tenant_id=t and conversation_id=c and user_id=actor for share;
 if not found or not chat_private.allowed(t,c) then raise exception using errcode='42501',message='Chat unavailable'; end if;
 if action='send' then
  if v.kind='group' and not v.allow_member_messages and not chat_private.group_manager(t,c) then
   raise exception using errcode='P0001',message='Only group admins can post';
  end if;
  return chat_private.act(t,p);
 end if;
 if v.kind<>'group' then raise exception using errcode='22023',message='Only groups have membership settings'; end if;
 if action='group_info' then
  return jsonb_build_object('id',c,'name',v.name,'description',v.description,'management_only',v.management_only,
   'allow_member_messages',v.allow_member_messages,'settings_revision',v.settings_revision,
   'can_manage',chat_private.group_manager(t,c),
   'members',coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',tm.display_name,'role',tm.role,'status',tm.status,'group_admin',m.group_admin) order by tm.display_name,m.user_id)
    from public.chat_members m join public.tenant_memberships tm on tm.tenant_id=m.tenant_id and tm.user_id=m.user_id
    where m.tenant_id=t and m.conversation_id=c),'[]'::jsonb));
 end if;
 if not chat_private.group_manager(t,c) then raise exception using errcode='42501',message='Group admin access required'; end if;
 if exists(select 1 from jsonb_object_keys(p) k where k not in ('action','conversationId','revision','members','group_admins','allow_member_messages'))
  or jsonb_typeof(p->'members') is distinct from 'array' or jsonb_typeof(p->'group_admins') is distinct from 'array'
  or jsonb_typeof(p->'allow_member_messages') is distinct from 'boolean'
  or jsonb_array_length(p->'members') not between 1 and 100 or jsonb_array_length(p->'group_admins')>100 then
  raise exception using errcode='22023',message='Invalid group settings';
 end if;
 expected_revision:=(p->>'revision')::integer;
 if expected_revision is null or expected_revision<>v.settings_revision then raise exception using errcode='40001',message='This group changed. Reload before saving'; end if;
 select array_agg(distinct value::uuid order by value::uuid) into members from jsonb_array_elements_text(p->'members');
 select coalesce(array_agg(distinct value::uuid order by value::uuid),'{}'::uuid[]) into admins from jsonb_array_elements_text(p->'group_admins');
 if not admins <@ members then raise exception using errcode='22023',message='Group admins must be members'; end if;
 perform 1 from public.tenant_memberships where tenant_id=t and user_id=any(members) order by user_id for share;
 select count(*) into member_count from public.tenant_memberships tm join auth.users u on u.id=tm.user_id
  where tm.tenant_id=t and tm.user_id=any(members)
   and (not v.management_only or tm.role in ('owner','admin','manager'))
   and ((tm.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true)
    or exists(select 1 from public.chat_members cm where cm.tenant_id=t and cm.conversation_id=c and cm.user_id=tm.user_id))
   and (not tm.user_id=any(admins) or (tm.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true)
    or exists(select 1 from public.chat_members cm where cm.tenant_id=t and cm.conversation_id=c and cm.user_id=tm.user_id and cm.group_admin));
 if member_count<>cardinality(members) then raise exception using errcode='42501',message='Members unavailable'; end if;
 if not exists(select 1 from public.tenant_memberships tm join auth.users u on u.id=tm.user_id
  where tm.tenant_id=t and tm.user_id=any(members) and tm.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true
   and (tm.user_id=any(admins) or tm.role in ('owner','admin'))) then
  raise exception using errcode='22023',message='Keep at least one active group admin';
 end if;
 delete from public.chat_members where tenant_id=t and conversation_id=c and not user_id=any(members);
 insert into public.chat_members(tenant_id,conversation_id,user_id,group_admin)
  select t,c,uid,uid=any(admins) from unnest(members) uid
  on conflict(conversation_id,user_id) do update set group_admin=excluded.group_admin;
 update public.chat_conversations set allow_member_messages=(p->>'allow_member_messages')::boolean,settings_revision=settings_revision+1
  where tenant_id=t and id=c returning * into v;
 insert into public.chat_group_audit values(t,c,v.settings_revision,actor,members,admins,v.allow_member_messages,clock_timestamp());
 return jsonb_build_object('id',c,'settings_revision',v.settings_revision);
end;
$$;
revoke all on function chat_private.group_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function chat_private.group_action(uuid,jsonb) to authenticated;
create or replace function public.chat_action(target_tenant uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select chat_private.group_action(target_tenant,payload) $$;
revoke all on function public.chat_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chat_action(uuid,jsonb) to authenticated;
commit;
notify pgrst,'reload schema';
