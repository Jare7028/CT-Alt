-- Additive owner-managed external Work Contacts; no legacy relations/functions changed.
begin;
create table public.directory_state(tenant_id uuid primary key,active boolean not null default false,management_revision integer not null default 0 check(management_revision>=0),visible_revision integer not null default 0 check(visible_revision>=0),check(not active or management_revision>0));
create table public.directory_work_contacts(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,name text not null,description text not null,phone text not null,email text not null,visible_in_app boolean not null default true,revision integer not null default 1 check(revision>0),created_at timestamptz not null default clock_timestamp(),updated_at timestamptz not null default clock_timestamp(),unique(tenant_id,id));
create index directory_contacts_page on public.directory_work_contacts(tenant_id,(lower(name) collate "C"),id);
create table public.directory_audit(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,actor_id uuid not null,operation_id uuid not null,action text not null check(action in('activate','create','visibility')),contact_id uuid,directory_revision integer not null check(directory_revision>0),contact_revision integer,occurred_at timestamptz not null default clock_timestamp(),unique(tenant_id,actor_id,operation_id));
create table workforce_private.directory_operations(tenant_id uuid not null,actor_id uuid not null,operation_id uuid not null,action text not null check(action in('activate','create','visibility')),contact_id uuid,state text not null check(state in('recorded','closed_absent')),payload_hash text,result jsonb,primary key(tenant_id,actor_id,operation_id),check((action='visibility')=(contact_id is not null)),check((state='recorded' and payload_hash~'^[a-f0-9]{64}$' and result is not null)or(state='closed_absent' and payload_hash is null and result is null)));
alter table public.directory_state enable row level security;
alter table public.directory_work_contacts enable row level security;
alter table public.directory_audit enable row level security;
alter table workforce_private.directory_operations enable row level security;
revoke all on public.directory_state,public.directory_work_contacts,public.directory_audit,workforce_private.directory_operations from public,anon,authenticated,service_role;

create function workforce_private.directory_utf16(v text)returns integer language sql immutable set search_path=''as $$select coalesce(sum(case when ascii(c)>65535 then 2 else 1 end),0)::integer from regexp_split_to_table(v,'')c where c<>''$$;
create function workforce_private.directory_keys(v jsonb,required text[],optional text[] default array[]::text[])returns void language plpgsql immutable set search_path=''as $$begin if v is null or jsonb_typeof(v)<>'object'or not v?&required or v-(required||optional)<>'{}'::jsonb then raise exception using errcode='22023',message='Invalid directory fields';end if;end$$;
create function workforce_private.directory_number(v jsonb,lo integer,hi integer)returns integer language plpgsql immutable set search_path=''as $$begin if jsonb_typeof(v)is distinct from'number'or v::text!~'^[0-9]{1,10}$'or v::numeric not between lo and hi then raise exception using errcode='22023',message='Invalid directory revision';end if;return v::text::integer;end$$;
create function workforce_private.directory_uuid(v jsonb)returns uuid language plpgsql immutable set search_path=''as $$begin if jsonb_typeof(v)is distinct from'string'or(v#>>'{}')!~*'^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$'then raise exception using errcode='22023',message='Invalid directory identity';end if;return(v#>>'{}')::uuid;end$$;
create function workforce_private.directory_json_unique(v json,depth integer default 0)returns boolean language plpgsql immutable set search_path=''as $$declare item json;begin if depth>8 then return false;end if;if json_typeof(v)='object'then if exists(select 1 from json_each(v)group by key having count(*)>1)then return false;end if;for item in select value from json_each(v)loop if not workforce_private.directory_json_unique(item,depth+1)then return false;end if;end loop;elsif json_typeof(v)='array'then for item in select value from json_array_elements(v)loop if not workforce_private.directory_json_unique(item,depth+1)then return false;end if;end loop;end if;return true;end$$;
create function workforce_private.directory_text(v jsonb,max_length integer,nonempty boolean default false) returns text language plpgsql immutable set search_path='' as $$declare s text;begin
 if jsonb_typeof(v) is distinct from 'string' then raise exception using errcode='22023',message='Invalid contact text';end if;s:=v#>>'{}';
 if workforce_private.directory_utf16(s)>max_length or s~U&'[\0001-\001F\007F-\009F]' then raise exception using errcode='22023',message='Invalid contact text';end if;
 s:=btrim(s,U&'\0009\000A\000B\000C\000D \00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
 if nonempty and s=''then raise exception using errcode='22023',message='Enter a contact name';end if;return s;end$$;
create function workforce_private.directory_access(t uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$declare r text;s public.directory_state;c public.tenants;begin
 r:=workforce_private.membership_role(t);if r is null then raise exception using errcode='42501',message='Directory access unavailable';end if;select *into c from public.tenants where id=t;select *into s from public.directory_state where tenant_id=t;
 if not coalesce(s.active,false) and r<>'owner'then raise exception using errcode='42501',message='Directory access unavailable';end if;
 return jsonb_build_object('schemaVersion',1,'company',jsonb_build_object('id',c.id,'name',c.name,'time_zone',c.time_zone),'actorId',auth.uid(),'role',r,'canManage',r='owner','active',coalesce(s.active,false),'viewRevision',case when r='owner'then coalesce(s.management_revision,0)else coalesce(s.visible_revision,0)end);end$$;
create function workforce_private.directory_locks(t uuid,op uuid) returns void language plpgsql volatile security definer set search_path='' as $$begin
 if auth.uid()is null or t is null or op is null then raise exception using errcode='42501',message='Directory access unavailable';end if;
 perform pg_advisory_xact_lock(hashtextextended('directory:'||t::text||':'||auth.uid()::text||':'||op::text,114));
 perform 1 from public.tenants where id=t and status='active' for update;if not found then raise exception using errcode='42501',message='Company access unavailable';end if;
 perform 1 from auth.users where id=auth.uid()for share;perform 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid()for share;
 if workforce_private.membership_role(t)is distinct from 'owner'then raise exception using errcode='42501',message='Directory management unavailable';end if;
 insert into public.directory_state(tenant_id)values(t)on conflict do nothing;perform 1 from public.directory_state where tenant_id=t for update;
end$$;
create function workforce_private.directory_contact(c public.directory_work_contacts) returns jsonb language sql stable set search_path='' as $$select jsonb_build_object('id',(c).id,'name',(c).name,'description',(c).description,'phone',(c).phone,'email',(c).email,'visible_in_app',(c).visible_in_app,'revision',(c).revision,'created_at',to_char((c).created_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),'updated_at',to_char((c).updated_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'))$$;
create function workforce_private.directory_raw(raw text)returns jsonb language plpgsql immutable set search_path=''as $$begin
 if raw is null or octet_length(raw)>65536 or not workforce_private.directory_json_unique(raw::json) then raise exception using errcode='22023',message='Invalid directory JSON';end if;return raw::jsonb;end$$;
create function workforce_private.read_directory(t uuid,raw text) returns jsonb language plpgsql stable security definer set search_path='' as $$declare q jsonb;ident jsonb;search text:='';lim integer:=100;position integer:=0;scope jsonb;decoded jsonb;rows jsonb;total integer;next_cursor text;begin
 ident:=workforce_private.directory_access(t);q:=workforce_private.directory_raw(raw);perform workforce_private.directory_keys(q,array['tenantId'],array['q','limit','cursor']);if workforce_private.directory_uuid(q->'tenantId')<>t then raise exception using errcode='22023',message='Invalid directory scope';end if;
 if q?'q'then search:=workforce_private.directory_text(q->'q',100);end if;if q?'limit'then lim:=workforce_private.directory_number(q->'limit',1,100);end if;
 scope:=jsonb_build_object('tenantId',t,'actorId',auth.uid(),'role',ident->'role','viewRevision',ident->'viewRevision','search',search);
 if q?'cursor'then
  if jsonb_typeof(q->'cursor')is distinct from'string'or length(q->>'cursor')>4096 then raise exception using errcode='22023',message='Invalid directory cursor';end if;
  begin if replace(encode(decode(q->>'cursor','base64'),'base64'),E'\n','')<>q->>'cursor'then raise exception using errcode='22023',message='Invalid directory cursor';end if;decoded:=workforce_private.directory_raw(convert_from(decode(q->>'cursor','base64'),'UTF8'));exception when others then raise exception using errcode='22023',message='Invalid directory cursor';end;
  perform workforce_private.directory_keys(decoded,array['scope','position']);if decoded->'scope'<>scope then raise exception using errcode='40001',message='Directory changed';end if;position:=workforce_private.directory_number(decoded->'position',1,1000);
 end if;
 with visible as materialized(select c.*from public.directory_work_contacts c where c.tenant_id=t and(ident->>'active')::boolean and((ident->>'canManage')::boolean or c.visible_in_app)and(search=''or position(lower(search)in lower(c.name||' '||c.description))>0)),page as(select *from visible order by lower(name)collate "C",id offset position limit lim)
 select(select count(*)from visible),coalesce(jsonb_agg(workforce_private.directory_contact(page::public.directory_work_contacts)order by lower(name)collate "C",id),'[]'::jsonb)into total,rows from page;
 if position>total then raise exception using errcode='40001',message='Directory changed';end if;
 if position+jsonb_array_length(rows)<total then next_cursor:=replace(encode(convert_to(jsonb_build_object('scope',scope,'position',position+jsonb_array_length(rows))::text,'UTF8'),'base64'),E'\n','');end if;
 return ident||jsonb_build_object('search',search,'contacts',rows,'page',jsonb_build_object('total',total,'nextCursor',next_cursor));end$$;
create function workforce_private.save_directory(t uuid,op uuid,raw text)returns jsonb language plpgsql volatile security definer set search_path=''as $$declare c jsonb;a text;expected integer;s public.directory_state;x public.directory_work_contacts;old public.directory_work_contacts;stored workforce_private.directory_operations;h text;result jsonb;cid uuid;cr integer;vis boolean;begin
 perform workforce_private.directory_locks(t,op);c:=workforce_private.directory_raw(raw);a:=c->>'action';
 if a='activate'then perform workforce_private.directory_keys(c,array['action','directory_revision']);
 elsif a='create'then perform workforce_private.directory_keys(c,array['action','directory_revision','name','description','phone','email']);c:=c||jsonb_build_object('name',workforce_private.directory_text(c->'name',100,true),'description',workforce_private.directory_text(c->'description',1000),'phone',workforce_private.directory_text(c->'phone',64),'email',workforce_private.directory_text(c->'email',254));
 elsif a='visibility'then perform workforce_private.directory_keys(c,array['action','directory_revision','contact_id','contact_revision','visible_in_app']);cid:=workforce_private.directory_uuid(c->'contact_id');cr:=workforce_private.directory_number(c->'contact_revision',1,2147483646);if jsonb_typeof(c->'visible_in_app')is distinct from'boolean'then raise exception using errcode='22023',message='Invalid contact visibility';end if;vis:=(c->>'visible_in_app')::boolean;
 else raise exception using errcode='22023',message='Invalid directory action';end if;
 expected:=workforce_private.directory_number(c->'directory_revision',0,2147483646);h:=encode(sha256(convert_to(c::text,'UTF8')),'hex');
 select *into stored from workforce_private.directory_operations where tenant_id=t and actor_id=auth.uid()and operation_id=op;
 if found then if stored.state='recorded'and stored.payload_hash=h and stored.action=a and stored.contact_id is not distinct from cid then return stored.result;end if;raise exception using errcode='40001',message='Directory operation already closed or changed';end if;
 if(select count(*)from workforce_private.directory_operations where tenant_id=t)>=20000 then raise exception using errcode='54000',message='Directory operation capacity reached';end if;
 select *into s from public.directory_state where tenant_id=t;
 if s.management_revision<>expected or s.management_revision=2147483647 then raise exception using errcode='40001',message='Directory changed';end if;
 if a='activate'then if s.active then raise exception using errcode='40001',message='Directory already activated';end if;
 elsif not s.active then raise exception using errcode='40001',message='Directory is not active';end if;
 if a='create'then
  if(select count(*)from public.directory_work_contacts where tenant_id=t)>=1000 then raise exception using errcode='54000',message='Directory contact capacity reached';end if;
  insert into public.directory_work_contacts(tenant_id,name,description,phone,email)values(t,c->>'name',c->>'description',c->>'phone',c->>'email')returning *into x;cid:=x.id;cr:=1;
 elsif a='visibility'then
  select *into old from public.directory_work_contacts where tenant_id=t and id=cid for update;
  if not found or old.revision<>cr then raise exception using errcode='40001',message='Contact changed';end if;
  update public.directory_work_contacts set visible_in_app=vis,revision=revision+1,updated_at=clock_timestamp()where tenant_id=t and id=cid returning *into x;cr:=x.revision;
 end if;
 update public.directory_state set active=true,management_revision=management_revision+1,visible_revision=visible_revision+case when a in('activate','create')or(a='visibility'and(old.visible_in_app or vis))then 1 else 0 end where tenant_id=t returning *into s;
 result:=jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',auth.uid(),'operationId',op,'action',a,'directory_revision',s.management_revision,'contact_id',cid,'contact_revision',cr,'active',true);
 insert into public.directory_audit(tenant_id,actor_id,operation_id,action,contact_id,directory_revision,contact_revision)values(t,auth.uid(),op,a,cid,s.management_revision,cr);
 insert into workforce_private.directory_operations values(t,auth.uid(),op,a,case when a='visibility'then cid end,'recorded',h,result);return result;end$$;
create function workforce_private.reconcile_directory_operation(t uuid,op uuid,a text,cid uuid)returns jsonb language plpgsql volatile security definer set search_path=''as $$declare stored workforce_private.directory_operations;begin
 perform workforce_private.directory_locks(t,op);
 if a is null or a not in('activate','create','visibility')or((a='visibility')<>(cid is not null))then raise exception using errcode='22023',message='Invalid recovery scope';end if;
 select *into stored from workforce_private.directory_operations where tenant_id=t and actor_id=auth.uid()and operation_id=op;
 if found then if stored.action<>a or stored.contact_id is distinct from cid then raise exception using errcode='40001',message='Recovery scope changed';end if;
 else
  if(select count(*)from workforce_private.directory_operations where tenant_id=t)>=20000 then raise exception using errcode='54000',message='Directory operation capacity reached';end if;
  insert into workforce_private.directory_operations values(t,auth.uid(),op,a,cid,'closed_absent',null,null)returning *into stored;
 end if;
 return jsonb_build_object('schemaVersion',1,'tenantId',t,'actorId',auth.uid(),'operationId',op,'action',a,'contactId',cid,'status',case when stored.state='recorded'then'recorded'else'not_recorded'end,'saved',stored.result);end$$;
create function public.read_directory_access(target_tenant uuid)returns jsonb language sql stable security invoker set search_path=''as $$select workforce_private.directory_access(target_tenant)$$;
create function public.read_directory(target_tenant uuid,raw_query text)returns jsonb language sql stable security invoker set search_path=''as $$select workforce_private.read_directory(target_tenant,raw_query)$$;
create function public.save_directory(target_tenant uuid,operation_id uuid,raw_change text)returns jsonb language sql volatile security invoker set search_path=''as $$select workforce_private.save_directory(target_tenant,operation_id,raw_change)$$;
create function public.reconcile_directory_operation(target_tenant uuid,operation_id uuid,target_action text,target_contact uuid)returns jsonb language sql volatile security invoker set search_path=''as $$select workforce_private.reconcile_directory_operation(target_tenant,operation_id,target_action,target_contact)$$;
-- Only contacts expose direct reads, filtered by confirmed current membership and activation.
create function workforce_private.directory_active(t uuid)returns boolean language sql stable security definer set search_path=''as $$select coalesce((select active from public.directory_state where tenant_id=t),false)and workforce_private.membership_role(t)is not null$$;
create policy directory_contacts_read on public.directory_work_contacts for select to authenticated using(workforce_private.directory_active(tenant_id)and(workforce_private.membership_role(tenant_id)='owner'or visible_in_app));
grant select on public.directory_work_contacts to authenticated;
revoke all on function workforce_private.directory_utf16(text),workforce_private.directory_keys(jsonb,text[],text[]),workforce_private.directory_number(jsonb,integer,integer),workforce_private.directory_uuid(jsonb),workforce_private.directory_json_unique(json,integer),workforce_private.directory_text(jsonb,integer,boolean),workforce_private.directory_access(uuid),workforce_private.directory_locks(uuid,uuid),workforce_private.directory_contact(public.directory_work_contacts),workforce_private.directory_raw(text),workforce_private.read_directory(uuid,text),workforce_private.save_directory(uuid,uuid,text),workforce_private.reconcile_directory_operation(uuid,uuid,text,uuid),workforce_private.directory_active(uuid),public.read_directory_access(uuid),public.read_directory(uuid,text),public.save_directory(uuid,uuid,text),public.reconcile_directory_operation(uuid,uuid,text,uuid)from public,anon,authenticated,service_role;
grant execute on function workforce_private.directory_access(uuid),workforce_private.read_directory(uuid,text),workforce_private.save_directory(uuid,uuid,text),workforce_private.reconcile_directory_operation(uuid,uuid,text,uuid),workforce_private.directory_active(uuid),public.read_directory_access(uuid),public.read_directory(uuid,text),public.save_directory(uuid,uuid,text),public.reconcile_directory_operation(uuid,uuid,text,uuid)to authenticated;
commit;
