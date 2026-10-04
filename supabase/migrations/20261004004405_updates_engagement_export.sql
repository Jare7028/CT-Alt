begin;
-- Read-only whole-scope export. No baseline table, policy or function changes.
create function public.read_update_recipients_export(target_tenant uuid,target_post uuid,status_filter text default 'all') returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare export_role text:=workforce_private.membership_role(target_tenant);post public.updates_posts;counts jsonb;rows jsonb;matched bigint;begin
 if export_role is null or export_role not in('owner','admin') then raise exception using errcode='42501',message='Management unavailable';end if;
 if target_tenant is null or target_post is null or status_filter is null or status_filter not in('all','viewed','unviewed','confirmed','unconfirmed') then raise exception using errcode='22023',message='Invalid export scope';end if;
 select * into post from public.updates_posts where tenant_id=target_tenant and id=target_post;
 if not found then raise exception using errcode='42501',message='Update unavailable';end if;
 select jsonb_build_object('total',count(*),'viewed',count(*)filter(where viewed_at is not null),'confirmed',count(*)filter(where confirmed_at is not null)) into counts from public.updates_recipients where tenant_id=target_tenant and post_id=target_post;
 if (counts->>'total')::bigint>500 then raise exception using errcode='54000',message='Export exceeds fixed audience bound';end if;
 select count(*),coalesce(jsonb_agg(jsonb_build_object('actorId',actor_id,'name',name,
 'viewedAt',case when viewed_at is null then null else to_char(viewed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')end,
 'confirmedAt',case when confirmed_at is null then null else to_char(confirmed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')end) order by actor_id),'[]') into matched,rows
 from public.updates_recipients where tenant_id=target_tenant and post_id=target_post and
 (case status_filter when 'viewed' then viewed_at is not null when 'unviewed' then viewed_at is null when 'confirmed' then confirmed_at is not null when 'unconfirmed' then confirmed_at is null else true end);
 return jsonb_build_object('tenantId',target_tenant,'actorId',(select auth.uid()),'role',export_role,'postId',target_post,'postStatus',post.status,'postRevision',post.revision,'contentRevision',post.content_revision,'requireConfirmation',post.require_confirmation,'status',status_filter,'counts',counts,'matchedCount',matched,'recipients',rows);
end $$;
revoke all on function public.read_update_recipients_export(uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.read_update_recipients_export(uuid,uuid,text) to authenticated;
commit;
