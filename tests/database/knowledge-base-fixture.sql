-- Populate the already-applied organizational module before Knowledge Base.
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare s jsonb;begin
 s:=public.save_smart_group('88000000-0000-4000-8000-000000000001',gen_random_uuid(),'{"action":"create_segment","name":"Retained segment","description":"Original"}');
 perform public.save_smart_group('88000000-0000-4000-8000-000000000001',gen_random_uuid(),jsonb_build_object('action','create_group','segmentId',s->>'segmentId','name','Retained group','description','Original','rules','[{"field":"title","values":["Cook"]}]'::jsonb));
end$$;
reset role;
-- Meaningful retained communication rows; chat_private contains helpers, not tables.
insert into public.chat_conversations(id,tenant_id,kind,name,last_sequence)values('8b000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','group','Retained synthetic chat',1);
insert into public.chat_members(tenant_id,conversation_id,user_id)values('88000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000901');
insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body)values('88000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000001',1,'00000000-0000-4000-8000-000000000901','Retained synthetic owner','8b000000-0000-4000-8000-000000000002','Retained original message');
insert into public.chat_reads(tenant_id,conversation_id,user_id,sequence)values('88000000-0000-4000-8000-000000000001','8b000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000901',1);
-- Populate original Agent identity and private receipts for all prior mutation modules.
insert into public.agents(id,tenant_id,user_id,first_name,last_name,phone,title,created_by)values('8c000000-0000-4000-8000-000000000001','88000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000901','Retained','Synthetic','+15550000111','Cook','00000000-0000-4000-8000-000000000901');
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';s jsonb;entry jsonb;begin
 s:=public.save_time_clock(t,gen_random_uuid(),'{"action":"create_job","name":"Retained original job"}');entry:=public.save_time_clock(t,gen_random_uuid(),jsonb_build_object('action','clock_in','jobId',s->>'jobId'));
 perform public.save_time_clock(t,gen_random_uuid(),jsonb_build_object('action','clock_out','entryId',entry->>'entryId','revision',1));
 s:=public.save_time_off(t,gen_random_uuid(),'{"action":"create_type","name":"Retained original leave","description":"Original","paid":true}');
 perform public.save_time_off(t,gen_random_uuid(),jsonb_build_object('action','request','agentId','8c000000-0000-4000-8000-000000000001','typeId',s->>'typeId','startDate','2026-10-10','endDate','2026-10-11','note','Retained original note'));
 perform public.save_quick_task(t,gen_random_uuid(),'{"action":"create","mode":"group","publication":"draft","title":"Retained original task","description":"Original","agentIds":["8c000000-0000-4000-8000-000000000001"],"startDate":null,"dueDate":null}');
end$$;
reset role;
