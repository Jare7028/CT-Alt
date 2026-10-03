\set ON_ERROR_STOP on
create function pg_temp.check_true(ok boolean,label text) returns void language plpgsql as $$ begin if ok is distinct from true then raise exception 'FAIL: %',label; end if; raise notice 'PASS: %',label; end $$;
create function pg_temp.denied(query text,code text,label text) returns void language plpgsql as $$ begin begin execute query; exception when others then if sqlstate=code then raise notice 'PASS: %',label; return; end if; raise; end; raise exception 'FAIL: %',label; end $$;
create function pg_temp.act(p jsonb) returns jsonb language sql as $$ select public.chat_action('30000000-0000-0000-0000-000000000001',p) $$;
create function pg_temp.conversation() returns uuid language sql as $$ select current_setting('chat.test.c')::uuid $$;
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(301,306)n;
insert into public.tenants(id,name) values ('30000000-0000-0000-0000-000000000001','Chat synthetic A'),('30000000-0000-0000-0000-000000000002','Chat synthetic B');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000301','Chat owner','owner'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000302','Chat employee','employee'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000303','Private outsider admin','admin'),
 ('30000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000304','Chat manager','manager'),
 ('30000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000305','Foreign owner','owner');
do $$ declare tab text; op text; begin
 foreach tab in array array['chat_conversations','chat_members','chat_messages','chat_reads'] loop
  perform pg_temp.check_true((select relrowsecurity from pg_class where oid=('public.'||tab)::regclass),'chat RLS enabled: '||tab);
  foreach op in array array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER'] loop
   perform pg_temp.check_true(not has_table_privilege('anon','public.'||tab,op),'anon denied '||op||' '||tab);
   if op<>'SELECT' then perform pg_temp.check_true(not has_table_privilege('authenticated','public.'||tab,op),'direct browser denied '||op||' '||tab); end if;
  end loop;
 end loop;
end $$;
select pg_temp.check_true(not has_function_privilege('anon','public.chat_action(uuid,jsonb)','EXECUTE'),'anonymous RPC denied');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select set_config('chat.test.c',pg_temp.act('{"action":"create","kind":"direct","members":["00000000-0000-0000-0000-000000000302"]}')->>'id',false);
select pg_temp.check_true(pg_temp.act('{"action":"create","kind":"direct","members":["00000000-0000-0000-0000-000000000302"]}')->>'id'=pg_temp.conversation()::text,'direct conversation reopens without duplicate');
select pg_temp.denied($q$select pg_temp.act('{"action":"create","kind":"group","name":"Foreign","members":["00000000-0000-0000-0000-000000000305"]}')$q$,'42501','cross-tenant membership denied');
select pg_temp.denied($q$select pg_temp.act('{"action":"create","kind":"group","name":"Managers","management_only":true,"members":["00000000-0000-0000-0000-000000000302"]}')$q$,'42501','management group rejects employee participants');
select set_config('chat.test.management',pg_temp.act('{"action":"create","kind":"group","name":"Management","management_only":true,"members":["00000000-0000-0000-0000-000000000304"]}')->>'id',false);
select set_config('chat.test.group',pg_temp.act('{"action":"create","kind":"group","name":"Team","description":"Synthetic context","members":["00000000-0000-0000-0000-000000000302","00000000-0000-0000-0000-000000000304"]}')->>'id',false);
select pg_temp.check_true(pg_temp.act(jsonb_build_object('action','send','conversationId',pg_temp.conversation(),'clientId','50000000-0000-0000-0000-000000000001','body','First'))->>'sequence'='1','server assigns first sequence');
select pg_temp.check_true(pg_temp.act(jsonb_build_object('action','send','conversationId',pg_temp.conversation(),'clientId','50000000-0000-0000-0000-000000000001','body','First'))->>'sequence'='1','duplicate retry returns original sequence');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"send","conversationId":"%s","clientId":"50000000-0000-0000-0000-000000000001","body":"Changed"}')$q$,pg_temp.conversation()),'22023','retry cannot change payload');
select pg_temp.check_true((select count(*)=1 from public.chat_messages),'retry creates exactly one persistent message');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"send","conversationId":"%s","clientId":"50000000-0000-0000-0000-000000000002","body":" "}')$q$,pg_temp.conversation()),'23514','blank text rejected in database');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',false);
select pg_temp.check_true(pg_temp.act('{"action":"list"}') @> jsonb_build_array(jsonb_build_object('id',pg_temp.conversation(),'unread',1)),'recipient has one unread message');
select pg_temp.check_true(jsonb_array_length(pg_temp.act('{"action":"directory"}'))=4,'chat directory offers only active confirmed tenant participants');
select pg_temp.check_true(pg_temp.act(jsonb_build_object('action','send','conversationId',pg_temp.conversation(),'clientId','50000000-0000-0000-0000-000000000002','body','Second'))->>'sequence'='2','other participant gets next ordered sequence');
select pg_temp.check_true(pg_temp.act(jsonb_build_object('action','history','conversationId',pg_temp.conversation()))->0->>'body'='First','reconnect history ordered oldest to newest');
select pg_temp.check_true(jsonb_array_length(pg_temp.act(jsonb_build_object('action','history','conversationId',pg_temp.conversation(),'before',2)))=1,'history cursor excludes duplicate boundary');
select pg_temp.act(jsonb_build_object('action','read','conversationId',pg_temp.conversation(),'sequence',2));
select pg_temp.act(jsonb_build_object('action','read','conversationId',pg_temp.conversation(),'sequence',0));
select pg_temp.check_true(pg_temp.act('{"action":"list"}') @> jsonb_build_array(jsonb_build_object('id',pg_temp.conversation(),'unread',0)),'read cursor monotonic across stale requests');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"read","conversationId":"%s","sequence":100}')$q$,pg_temp.conversation()),'22023','cannot mark unseen future messages read');
select pg_temp.denied($q$select pg_temp.act('{"action":"create","kind":"group","name":"Management","management_only":true,"members":["00000000-0000-0000-0000-000000000304"]}')$q$,'42501','employee cannot create restricted management group');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000303',false);
select pg_temp.check_true((select count(*)=0 from public.chat_messages),'same-tenant admin cannot read private conversations');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"history","conversationId":"%s"}')$q$,pg_temp.conversation()),'42501','private outsider history denied');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"send","conversationId":"%s","clientId":"50000000-0000-0000-0000-000000000003","body":"Intrusion"}')$q$,pg_temp.conversation()),'42501','private outsider send denied');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000305',false);
select pg_temp.check_true((select count(*)=0 from public.chat_messages),'cross-tenant direct table reads empty');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"history","conversationId":"%s"}')$q$,pg_temp.conversation()),'42501','cross-tenant history denied');
reset role;
update public.tenant_memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000304';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000304',false);
select pg_temp.check_true((select count(*)=0 from public.chat_conversations where id=current_setting('chat.test.management')::uuid),'demotion immediately removes management group access');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"history","conversationId":"%s"}')$q$,current_setting('chat.test.management')),'42501','demoted role denied management RPC');
reset role;
update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000302';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',false);
select pg_temp.check_true((select count(*)=0 from public.chat_messages),'suspension immediately denies table history with existing identity');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"send","conversationId":"%s","clientId":"50000000-0000-0000-0000-000000000003","body":"Suspended"}')$q$,pg_temp.conversation()),'42501','suspended participant send denied');
reset role;
update public.tenant_memberships set status='active' where user_id='00000000-0000-0000-0000-000000000302';
delete from public.chat_members where user_id='00000000-0000-0000-0000-000000000302';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000302',false);
select pg_temp.check_true((select count(*)=0 from public.chat_messages),'conversation removal immediately denies history');
select pg_temp.denied(format($q$select pg_temp.act('{"action":"history","conversationId":"%s"}')$q$,pg_temp.conversation()),'42501','removed member RPC denied');
select pg_temp.denied($q$select pg_temp.act('{"action":"create","kind":"direct","members":["00000000-0000-0000-0000-000000000301"]}')$q$,'42501','reopening direct chat cannot undo removal');
reset role;
update auth.users set raw_user_meta_data='{"role":"owner","tenant_id":"30000000-0000-0000-0000-000000000001"}' where id='00000000-0000-0000-0000-000000000306';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000306',false);
select pg_temp.denied($q$select pg_temp.act('{"action":"list"}')$q$,'42501','editable metadata cannot grant chat access');
reset role;
