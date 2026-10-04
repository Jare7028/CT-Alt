-- Populate released Requests before the private Files upgrade using signed RPCs.
-- Synthetic disposable database only: preserve records, audit and UUID receipts.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare t uuid:='88000000-0000-4000-8000-000000000001';r jsonb;begin
 r:=public.save_request(t,'6f300000-0000-4000-8000-000000000001',jsonb_build_object('action','create','title','Retained files upgrade request','description','Synthetic operational history','priority','high','dueDate','2026-10-04','assigneeAgentId',null,'assigneeActorId',null)::text);
 perform public.save_request(t,'6f300000-0000-4000-8000-000000000002',jsonb_build_object('action','move','requestId',r->>'requestId','revision',r->'revision','status','in_progress')::text);
 perform public.reconcile_request_operation(t,'6f300000-0000-4000-8000-000000000003','create');
end$$;
reset role;
