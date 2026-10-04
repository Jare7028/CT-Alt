-- Populate released Forms through its real mutation protocol before the reporting upgrade.
-- Synthetic disposable database only; retain private progress, submitted edits/review,
-- history, audit, receipts and a durable absent-operation tombstone unchanged.
set role authenticated;
select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare
 t uuid:='88000000-0000-4000-8000-000000000001';
 f jsonb;r jsonb;field uuid:='6f200000-0000-4000-8000-000000000001';
begin
 f:=public.save_form(t,gen_random_uuid(),jsonb_build_object('action','create_form','name','Retained Forms original','description','Synthetic upgrade baseline','schema',jsonb_build_array(jsonb_build_object('id',field,'kind','text','label','Original question','required',true)),'audienceIds',jsonb_build_array('00000000-0000-4000-8000-000000000901','00000000-0000-4000-8000-000000000903'),'allowRespondentEdit',true)::text);
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','publish_form','formId',f->>'formId','formRevision',1)::text);
 r:=public.save_form(t,gen_random_uuid(),jsonb_build_object('action','save_progress','formId',f->>'formId','formRevision',2,'responseRevision',0,'answers',jsonb_build_object(field::text,'Original unfinished answer'))::text);
 r:=public.save_form(t,gen_random_uuid(),jsonb_build_object('action','submit_response','formId',f->>'formId','formRevision',2,'responseRevision',1,'answers',jsonb_build_object(field::text,'Original submitted answer'))::text);
 r:=public.save_form(t,gen_random_uuid(),jsonb_build_object('action','edit_response','formId',f->>'formId','formRevision',2,'responseRevision',2,'answers',jsonb_build_object(field::text,'Retained edited answer'))::text);
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','review_response','formId',f->>'formId','formRevision',2,'responseId',r->>'responseId','responseRevision',3,'reviewed',true)::text);
 perform public.reconcile_form_operation(t,gen_random_uuid(),'create_form');
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000903',false);
 perform public.save_form(t,gen_random_uuid(),jsonb_build_object('action','save_progress','formId',f->>'formId','formRevision',2,'responseRevision',0,'answers',jsonb_build_object(field::text,'Private original actor unfinished answer'))::text);
end$$;
reset role;
