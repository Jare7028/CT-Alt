begin;
create schema chat_private;
revoke all on schema chat_private from public, anon, authenticated;
grant usage on schema chat_private to authenticated;
create table public.chat_conversations (
 id uuid primary key default gen_random_uuid(), tenant_id uuid not null references public.tenants(id),
 kind text not null check(kind in ('direct','group')), name text not null check(length(name) between 1 and 100),
 description text not null default '' check(length(description)<=1000), management_only boolean not null default false,
 direct_key text, last_sequence bigint not null default 0 check(last_sequence between 0 and 9007199254740991), updated_at timestamptz not null default now(),
 unique(tenant_id,id), unique(tenant_id,direct_key), check((kind='direct')=(direct_key is not null)),
 check(kind='group' or not management_only)
);
create table public.chat_members (
 tenant_id uuid not null, conversation_id uuid not null, user_id uuid not null,
 primary key(conversation_id,user_id),
 foreign key(tenant_id,conversation_id) references public.chat_conversations(tenant_id,id) on delete cascade,
 foreign key(tenant_id,user_id) references public.tenant_memberships(tenant_id,user_id) on delete cascade
);
create table public.chat_messages (
 tenant_id uuid not null, conversation_id uuid not null, sequence bigint not null,
 sender_id uuid not null, sender_name text not null, client_id uuid not null,
 body text not null check(length(btrim(body)) between 1 and 4000), created_at timestamptz not null default clock_timestamp(),
 primary key(conversation_id,sequence), unique(conversation_id,sender_id,client_id),
 foreign key(tenant_id,conversation_id) references public.chat_conversations(tenant_id,id) on delete cascade,
 foreign key(tenant_id,sender_id) references public.tenant_memberships(tenant_id,user_id)
);
create table public.chat_reads (
 tenant_id uuid not null, conversation_id uuid not null, user_id uuid not null, sequence bigint not null default 0,
 primary key(conversation_id,user_id),
 foreign key(tenant_id,conversation_id) references public.chat_conversations(tenant_id,id) on delete cascade,
 foreign key(tenant_id,user_id) references public.tenant_memberships(tenant_id,user_id) on delete cascade
);
create index chat_members_actor on public.chat_members(user_id,tenant_id,conversation_id);
create function chat_private.allowed(t uuid,c uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select workforce_private.membership_role(t) is not null and exists(
 select 1 from public.chat_members m join public.chat_conversations v on v.id=m.conversation_id and v.tenant_id=m.tenant_id
 where m.tenant_id=t and m.conversation_id=c and m.user_id=auth.uid()
 and (not v.management_only or workforce_private.membership_role(t) in ('owner','admin','manager')))
$$;
revoke all on function chat_private.allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function chat_private.allowed(uuid,uuid) to authenticated;
alter table public.chat_conversations enable row level security;
alter table public.chat_members enable row level security;
alter table public.chat_messages enable row level security;
alter table public.chat_reads enable row level security;
revoke all on public.chat_conversations,public.chat_members,public.chat_messages,public.chat_reads from public,anon,authenticated;
grant select on public.chat_conversations,public.chat_members,public.chat_messages,public.chat_reads to authenticated;
grant all on public.chat_conversations,public.chat_members,public.chat_messages,public.chat_reads to service_role;
create policy chat_conversations_read on public.chat_conversations for select to authenticated using(chat_private.allowed(tenant_id,id));
create policy chat_members_read on public.chat_members for select to authenticated using(chat_private.allowed(tenant_id,conversation_id));
create policy chat_messages_read on public.chat_messages for select to authenticated using(chat_private.allowed(tenant_id,conversation_id));
create policy chat_reads_read on public.chat_reads for select to authenticated using(user_id=auth.uid() and chat_private.allowed(tenant_id,conversation_id));
-- All public RPCs are invoker wrappers. Definers live in a non-exposed schema.
-- Lock live tenant/member rows before mutations; suspension cannot race writes.
create function chat_private.act(t uuid, payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); actor_role text; actor_name text; action text:=payload->>'action'; c uuid; v public.chat_conversations%rowtype; msg public.chat_messages%rowtype; people uuid[]; person record; key text; last_read bigint; new_conversation boolean; selected_user uuid;
begin
 if payload is null or jsonb_typeof(payload)<>'object' or octet_length(payload::text)>24000 then raise exception using errcode='22023',message='Invalid chat request'; end if;
 perform 1 from public.tenants where id=t and status='active' for share;
 if not found then raise exception using errcode='42501',message='Company access unavailable'; end if;
 select role,display_name into actor_role,actor_name from public.tenant_memberships where tenant_id=t and user_id=actor and status='active' for share;
 if actor_role is null or workforce_private.membership_role(t) is null then raise exception using errcode='42501',message='Chat access unavailable'; end if;
 if action='directory' then
  return coalesce((select jsonb_agg(jsonb_build_object('user_id',m.user_id,'display_name',m.display_name,'role',m.role) order by m.display_name,m.user_id) from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true),'[]'::jsonb);
 elsif action='create' then
  if payload->>'kind' is null or payload->>'kind' not in ('direct','group') then raise exception using errcode='22023',message='Choose a chat type'; end if;
  if jsonb_typeof(payload->'members') is distinct from 'array' or jsonb_array_length(payload->'members') not between 1 and 99 then raise exception using errcode='22023',message='Choose members'; end if;
  select array_agg(distinct x order by x) into people from (select value::uuid x from jsonb_array_elements_text(payload->'members') union select actor) ids;
  if payload->>'kind'='direct' and cardinality(people)<>2 then raise exception using errcode='22023',message='Choose one other person'; end if;
  if coalesce((payload->>'management_only')::boolean,false) and actor_role not in ('owner','admin','manager') then raise exception using errcode='42501',message='Management access required'; end if;
  perform 1 from public.tenant_memberships where tenant_id=t and user_id=any(people) order by user_id for share;
  if (select count(*) from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.user_id=any(people) and m.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true and (not coalesce((payload->>'management_only')::boolean,false) or m.role in ('owner','admin','manager')))<>cardinality(people) then raise exception using errcode='42501',message='Members unavailable'; end if;
  if payload->>'kind'='direct' then key:=array_to_string(people,':'); end if;
  insert into public.chat_conversations(tenant_id,kind,name,description,management_only,direct_key)
   values(t,payload->>'kind',case when key is not null then 'Direct chat' else btrim(payload->>'name') end,coalesce(payload->>'description',''),coalesce((payload->>'management_only')::boolean,false),key)
   on conflict(tenant_id,direct_key) do nothing returning id into c;
  new_conversation:=found;
  -- Existing direct chats retain their membership: removal never silently re-adds.
  if not new_conversation then
   select id into c from public.chat_conversations where tenant_id=t and direct_key=key for update;
   if not chat_private.allowed(t,c) then raise exception using errcode='42501',message='Chat unavailable'; end if;
  else
   foreach selected_user in array people loop insert into public.chat_members values(t,c,selected_user); end loop;
  end if;
  return jsonb_build_object('id',c);
 elsif action='list' then
  return coalesce((select jsonb_agg(row_data order by (row_data->>'updated_at') desc,row_data->>'id') from (
   select jsonb_build_object('id',cv.id,'kind',cv.kind,'name',case when cv.kind='direct' then coalesce((select tm.display_name from public.chat_members cm join public.tenant_memberships tm on tm.user_id=cm.user_id and tm.tenant_id=cm.tenant_id where cm.conversation_id=cv.id and cm.user_id<>actor limit 1),'Direct chat') else cv.name end,'description',cv.description,'management_only',cv.management_only,'updated_at',cv.updated_at,'preview',(select left(ms.sender_name||': '||ms.body,150) from public.chat_messages ms where ms.conversation_id=cv.id order by ms.sequence desc limit 1),'member_count',(select count(*) from public.chat_members cm join public.tenant_memberships tm on tm.tenant_id=cm.tenant_id and tm.user_id=cm.user_id join auth.users u on u.id=tm.user_id where cm.conversation_id=cv.id and tm.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true and (not cv.management_only or tm.role in ('owner','admin','manager'))),'unread',(select count(*) from public.chat_messages ms where ms.conversation_id=cv.id and ms.sender_id<>actor and ms.sequence>coalesce((select r.sequence from public.chat_reads r where r.conversation_id=cv.id and r.user_id=actor),0))) row_data
   from public.chat_conversations cv where cv.tenant_id=t and chat_private.allowed(t,cv.id)
  ) rows),'[]'::jsonb);
 end if;
 c:=(payload->>'conversationId')::uuid;
 select * into v from public.chat_conversations where tenant_id=t and id=c for update;
 if not found or not chat_private.allowed(t,c) then raise exception using errcode='42501',message='Chat unavailable'; end if;
 perform 1 from public.chat_members where conversation_id=c and user_id=actor for share;
 if not found or not chat_private.allowed(t,c) then raise exception using errcode='42501',message='Chat unavailable'; end if;
 if action='history' then
  return coalesce((select jsonb_agg(to_jsonb(m) order by m.sequence) from (select * from public.chat_messages where conversation_id=c and sequence<coalesce((payload->>'before')::bigint,9223372036854775807) and sequence>coalesce((payload->>'after')::bigint,0) order by case when payload ? 'after' then sequence end asc, sequence desc limit 100) m),'[]'::jsonb);
 elsif action='send' then
  select * into msg from public.chat_messages where conversation_id=c and sender_id=actor and client_id=(payload->>'clientId')::uuid;
  if found then
   if msg.body is distinct from payload->>'body' then raise exception using errcode='22023',message='Retry payload changed'; end if;
   return to_jsonb(msg);
  end if;
  update public.chat_conversations set last_sequence=last_sequence+1,updated_at=clock_timestamp() where id=c returning * into v;
  insert into public.chat_messages values(t,c,v.last_sequence,actor,actor_name,(payload->>'clientId')::uuid,payload->>'body',clock_timestamp()) returning * into msg;
  return to_jsonb(msg);
 elsif action='read' then
  last_read:=(payload->>'sequence')::bigint;
  if last_read is null or last_read<0 or last_read>v.last_sequence then raise exception using errcode='22023',message='Invalid read position'; end if;
  insert into public.chat_reads values(t,c,actor,last_read) on conflict(conversation_id,user_id) do update set sequence=greatest(public.chat_reads.sequence,excluded.sequence);
  return '{}'::jsonb;
 end if;
 raise exception using errcode='22023',message='Unknown action';
end;
$$;
revoke all on function chat_private.act(uuid,jsonb) from public,anon,authenticated;
grant execute on function chat_private.act(uuid,jsonb) to authenticated;
create function public.chat_action(target_tenant uuid,payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$ select chat_private.act(target_tenant,payload) $$;
revoke all on function public.chat_action(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.chat_action(uuid,jsonb) to authenticated;
-- Intentionally no publication, Realtime channel, storage bucket or settings change.
commit;
