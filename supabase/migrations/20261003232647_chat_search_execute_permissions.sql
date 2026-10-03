begin;
-- Supabase public-schema defaults grant service_role execution. The search
-- consumer uses a signed authenticated session; keep that grant explicit.
revoke execute on function public.search_chat_messages(uuid,uuid,text,integer,jsonb) from service_role;
commit;
