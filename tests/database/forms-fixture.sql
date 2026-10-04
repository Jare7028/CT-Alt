-- Original synthetic Knowledge Base rows/receipts retained during Forms upgrade.
set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000901',false);
do $$declare b jsonb;n jsonb;folder jsonb;t uuid:='88000000-0000-4000-8000-000000000001';begin
 b:=public.save_knowledge_base(t,gen_random_uuid(),'{"action":"create_base","name":"Retained original library","description":"Synthetic","audienceIds":["00000000-0000-4000-8000-000000000901"]}');
 folder:=public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','create_node','baseId',b->>'baseId','revision',1,'parentId',null,'kind','folder','name','Reference folder','description',''));
 n:=public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','create_node','baseId',b->>'baseId','revision',2,'parentId',folder->>'nodeId','kind','text','name','Original reference','description','','body','Retained original content'));
 b:=public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','publish_base','baseId',b->>'baseId','revision',3));
 perform public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','view','baseId',b->>'baseId','revision',4,'nodeId',n->>'nodeId','nodeRevision',1));
end$$;reset role;
