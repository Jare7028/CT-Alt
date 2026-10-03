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

-- Group permissions use a fresh synthetic tenant, never real account data.
reset role;
insert into auth.users(id,email_confirmed_at) select ('00000000-0000-0000-0000-'||lpad(n::text,12,'0'))::uuid,now() from generate_series(401,405)n;
insert into public.tenants(id,name) values ('40000000-0000-0000-0000-000000000001','Group permissions synthetic');
insert into public.tenant_memberships(tenant_id,user_id,display_name,role) values
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000401','Employee creator','employee'),
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000402','Employee member','employee'),
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000403','Private admin outsider','admin'),
 ('40000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000404','New member','employee');
create function pg_temp.groupact(p jsonb) returns jsonb language sql as $$ select public.chat_action('40000000-0000-0000-0000-000000000001',p) $$;
create function pg_temp.groupmanage(rev int, members jsonb, admins jsonb, posting boolean) returns jsonb language sql as $$ select pg_temp.groupact(jsonb_build_object('action','manage_group','conversationId',current_setting('chat.permissions.group'),'revision',rev,'members',members,'group_admins',admins,'allow_member_messages',posting)) $$;
select pg_temp.check_true(not has_function_privilege('authenticated','chat_private.act(uuid,jsonb)','EXECUTE'),'old core cannot bypass group posting gates');
select pg_temp.check_true((select relrowsecurity from pg_class where oid='public.chat_group_audit'::regclass),'group audit RLS enabled');
select pg_temp.check_true(not has_table_privilege('authenticated','public.chat_group_audit','INSERT') and not has_table_privilege('anon','public.chat_group_audit','SELECT'),'group audit browser mutation and anonymous reads denied');
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select set_config('chat.permissions.group',pg_temp.groupact('{"action":"create","kind":"group","name":"Synthetic team","members":["00000000-0000-0000-0000-000000000402"]}')->>'id',false);
select pg_temp.check_true((pg_temp.groupact('{"action":"list"}')->0->>'can_manage')::boolean,'employee creator is explicit group admin');
select pg_temp.groupact(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.group'),'clientId','60000000-0000-0000-0000-000000000001','body','Earlier history'));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select pg_temp.check_true(not (pg_temp.groupact('{"action":"list"}')->0->>'can_manage')::boolean,'ordinary group member cannot manage');
select pg_temp.groupact(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.group'),'clientId','60000000-0000-0000-0000-000000000002','body','Member before restriction'));
select pg_temp.denied($q$select pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000402"]','["00000000-0000-0000-0000-000000000402"]',false)$q$,'42501','member cannot promote self');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000403',false);
select pg_temp.denied($q$select pg_temp.groupact(jsonb_build_object('action','group_info','conversationId',current_setting('chat.permissions.group')))$q$,'42501','tenant admin outsider cannot inspect group');
select pg_temp.denied($q$select pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000403"]','[]',false)$q$,'42501','tenant admin outsider cannot manage group');
select pg_temp.check_true((select count(*)=0 from public.chat_group_audit),'outsider cannot read group audit');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.denied($q$select pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000305"]','["00000000-0000-0000-0000-000000000401"]',true)$q$,'42501','cannot add foreign tenant member');
select pg_temp.denied($q$select pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000402"]','[]',false)$q$,'22023','last active group admin cannot be removed');
select pg_temp.check_true(pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000402","00000000-0000-0000-0000-000000000404"]','["00000000-0000-0000-0000-000000000401"]',false)->>'settings_revision'='2','group admin adds member and restricts posting atomically');
select pg_temp.check_true((select count(*)=1 from public.chat_group_audit),'authorized changes audited once');
select pg_temp.denied($q$select pg_temp.groupmanage(1,'["00000000-0000-0000-0000-000000000401"]','["00000000-0000-0000-0000-000000000401"]',true)$q$,'40001','stale settings revision rejected');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.check_true(jsonb_array_length(pg_temp.groupact(jsonb_build_object('action','history','conversationId',current_setting('chat.permissions.group'))))=2,'newly added member can read all earlier messages');
select pg_temp.check_true((pg_temp.groupact('{"action":"list"}')->0->>'can_post')::boolean=false,'restricted posting listed as read only');
select pg_temp.denied($q$select pg_temp.groupact(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.group'),'clientId','60000000-0000-0000-0000-000000000003','body','Denied'))$q$,'P0001','ordinary member cannot post to admin only group');
select pg_temp.check_true((select count(*)=0 from public.chat_group_audit),'ordinary member cannot read group audit');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select pg_temp.denied($q$select pg_temp.groupact(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.group'),'clientId','60000000-0000-0000-0000-000000000002','body','Member before restriction'))$q$,'P0001','retry checks current posting permission before dedup');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000401',false);
select pg_temp.check_true(pg_temp.groupact(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.group'),'clientId','60000000-0000-0000-0000-000000000003','body','Admin announcement'))->>'sequence'='3','explicit employee group admin can post');
select pg_temp.groupmanage(2,'["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000404"]','["00000000-0000-0000-0000-000000000401","00000000-0000-0000-0000-000000000404"]',false);
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000402',false);
select pg_temp.check_true((select count(*)=0 from public.chat_messages where conversation_id=current_setting('chat.permissions.group')::uuid),'removed group member immediately loses table history');
select pg_temp.denied($q$select pg_temp.groupact(jsonb_build_object('action','history','conversationId',current_setting('chat.permissions.group')))$q$,'42501','removed group member immediately loses RPC history');
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.groupmanage(3,'["00000000-0000-0000-0000-000000000404"]','["00000000-0000-0000-0000-000000000404"]',true);
select pg_temp.check_true(jsonb_array_length(pg_temp.groupact(jsonb_build_object('action','group_info','conversationId',current_setting('chat.permissions.group')))->'members')=1,'newly assigned group admin can remove former creator');
reset role;
update public.tenant_memberships set status='suspended' where user_id='00000000-0000-0000-0000-000000000404';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000404',false);
select pg_temp.denied($q$select pg_temp.groupmanage(4,'["00000000-0000-0000-0000-000000000404"]','["00000000-0000-0000-0000-000000000404"]',true)$q$,'42501','suspended group admin immediately loses management');
reset role;
-- Group-admin flags never override restricted-management eligibility.
update public.tenant_memberships set role='manager' where user_id='00000000-0000-0000-0000-000000000304';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);
select set_config('chat.permissions.management',pg_temp.act('{"action":"create","kind":"group","name":"Restricted posting synthetic","management_only":true,"allow_member_messages":false,"members":["00000000-0000-0000-0000-000000000304"]}')->>'id',false);
select pg_temp.act(jsonb_build_object('action','manage_group','conversationId',current_setting('chat.permissions.management'),'revision',1,'members',jsonb_build_array('00000000-0000-0000-0000-000000000301','00000000-0000-0000-0000-000000000304'),'group_admins',jsonb_build_array('00000000-0000-0000-0000-000000000304'),'allow_member_messages',false));
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000304',false);
select pg_temp.check_true((pg_temp.act('{"action":"list"}') @> jsonb_build_array(jsonb_build_object('id',current_setting('chat.permissions.management'),'can_post',true))),'explicit management group admin can post');
reset role;
update public.tenant_memberships set role='employee' where user_id='00000000-0000-0000-0000-000000000304';
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000304',false);
select pg_temp.denied($q$select pg_temp.act(jsonb_build_object('action','send','conversationId',current_setting('chat.permissions.management'),'clientId','80000000-0000-0000-0000-000000000001','body','Demoted explicit group admin'))$q$,'42501','group admin flag cannot bypass management role demotion');
select pg_temp.denied($q$select pg_temp.act(jsonb_build_object('action','group_info','conversationId',current_setting('chat.permissions.management')))$q$,'42501','demoted group admin cannot inspect restricted group');
reset role;
