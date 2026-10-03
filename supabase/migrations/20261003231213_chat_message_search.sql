begin;
-- Search is read-only and runs under the signed caller's existing table RLS.
-- No existing Chat tables, policies, grants or write/read-marking RPCs change.
create function public.search_chat_messages(target_tenant uuid,target_conversation uuid,search_query text,page_limit integer default 50,after_message jsonb default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare actor uuid:=auth.uid();normalized_query text:=btrim(search_query);total bigint;messages jsonb;next_cursor jsonb;cursor_sequence bigint;
begin
 if actor is null or workforce_private.membership_role(target_tenant) is null or not chat_private.allowed(target_tenant,target_conversation) then raise exception using errcode='42501',message='Conversation access unavailable';end if;
 if normalized_query is null or length(normalized_query) not between 1 and 100 or page_limit is null or page_limit not between 1 and 100 then raise exception using errcode='22023',message='Invalid conversation search';end if;
 if after_message is not null then
  if jsonb_typeof(after_message) is distinct from 'object' or octet_length(after_message::text)>2048 or (after_message->>'tenantId') is distinct from target_tenant::text or (after_message->>'actorId') is distinct from actor::text or (after_message->>'conversationId') is distinct from target_conversation::text or (after_message->>'query') is distinct from normalized_query or exists(select 1 from jsonb_object_keys(after_message) k where k not in ('tenantId','actorId','conversationId','query','sequence')) or jsonb_typeof(after_message->'sequence') is distinct from 'string' or (after_message->>'sequence') is null or (after_message->>'sequence') !~ '^[1-9][0-9]{0,18}$' then raise exception using errcode='22023',message='Conversation search scope changed';end if;
  cursor_sequence:=(after_message->>'sequence')::bigint;
 end if;
 -- Count and page share one STABLE invoker snapshot. strpos treats %, _, quotes
 -- and SQL-shaped strings literally rather than as wildcard/dynamic SQL.
 select count(*) into total from public.chat_messages m where m.tenant_id=target_tenant and m.conversation_id=target_conversation and strpos(lower(m.body),lower(normalized_query))>0;
 select coalesce(jsonb_agg(jsonb_build_object('conversation_id',m.conversation_id,'sequence',m.sequence::text,'sender_id',m.sender_id,'sender_name',m.sender_name,'body',m.body,'created_at',m.created_at) order by m.sequence desc),'[]'::jsonb) into messages from (
  select * from public.chat_messages m where m.tenant_id=target_tenant and m.conversation_id=target_conversation and strpos(lower(m.body),lower(normalized_query))>0 and (cursor_sequence is null or m.sequence<cursor_sequence) order by m.sequence desc limit page_limit+1
 )m;
 if jsonb_array_length(messages)>page_limit then
  messages:=messages-page_limit;
  next_cursor:=jsonb_build_object('tenantId',target_tenant,'actorId',actor,'conversationId',target_conversation,'query',normalized_query,'sequence',messages->(page_limit-1)->>'sequence');
 end if;
 return jsonb_build_object('tenantId',target_tenant,'actorId',actor,'conversationId',target_conversation,'query',normalized_query,'total',total,'messages',messages,'nextCursor',next_cursor);
end;$$;
revoke all on function public.search_chat_messages(uuid,uuid,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.search_chat_messages(uuid,uuid,text,integer,jsonb) to authenticated;
commit;
