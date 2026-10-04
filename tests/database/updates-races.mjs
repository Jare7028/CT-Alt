const tenant='77000000-0000-0000-0000-000000000001';
const user=n=>`00000000-0000-0000-0000-${String(n).padStart(12,'0')}`;
const identity=n=>`set role authenticated;select set_config('request.jwt.claim.sub','${user(n)}',false);`;
const save=(n,a,extra)=>`select public.save_update('${tenant}','7b000000-0000-0000-0000-${String(n).padStart(12,'0')}',jsonb_build_object('action','${a}')||${extra});`;
export async function updatesRaceChecks({sql,query,asyncSql,waitingTransaction}){
 const checks=[];
 async function pair(firstSql,secondSql,expected,label){const first=asyncSql("set application_name='ct_alt_updates_race';begin;"+firstSql+'select pg_sleep(1.2);commit;');await waitingTransaction();const results=await Promise.all([first,asyncSql(secondSql)]);if(results[0].status!==0||results[1].status!==(expected?3:0)||expected&&!results[1].stderr.includes(expected))throw Error(label+JSON.stringify(results));checks.push('PASS: '+label);}
 const d=`jsonb_build_object('title','Race announcement','body','Synthetic race','recipientIds',jsonb_build_array('${user(704)}','${user(705)}'),'allowComments',true,'allowReactions',true,'requireConfirmation',true)`;
 await pair(identity(701)+save(1,'create',d),identity(701)+save(1,'create',d),null,'concurrent same UUID draft creation is exactly once');
 const post=query(`select result->>'postId' from workforce_private.updates_operations where operation_id='7b000000-0000-0000-0000-000000000001'`);
 const target=`jsonb_build_object('postId','${post}','contentRevision',1)`;
 sql(identity(701)+save(2,'publish',`jsonb_build_object('postId','${post}','revision',1)`));
 await pair(identity(704)+save(3,'comment',target+"||jsonb_build_object('body','Concurrent comment')"),identity(704)+save(3,'comment',target+"||jsonb_build_object('body','Concurrent comment')"),null,'concurrent same UUID comment once');
 if(query(`select count(*) from public.updates_comments where post_id='${post}'`)!=='1'||query(`select count(*) from public.updates_audit where post_id='${post}' and action='comment'`)!=='1')throw Error('Concurrent comment duplicated');checks.push('PASS: repeated response loss keeps one comment and audit');
 const cid=query(`select id from public.updates_comments where post_id='${post}'`),edit=target+`||jsonb_build_object('commentId','${cid}','revision',1,'body','Edited race')`;
 await pair(identity(704)+save(4,'edit_comment',edit),identity(704)+save(5,'edit_comment',edit),'40001','simultaneous comment edits serialize with one revision winner');
 await pair(identity(701)+save(6,'archive',`jsonb_build_object('postId','${post}','revision',2)`),identity(704)+save(7,'comment',target+"||jsonb_build_object('body','Denied after archive')"),'42501','queued archive prevents new comment');
 sql(identity(701)+save(8,'restore',`jsonb_build_object('postId','${post}','revision',3)`));
 await pair(`update public.tenant_memberships set status='suspended'where tenant_id='${tenant}'and user_id='${user(704)}';`,identity(704)+save(9,'like',target),'42501','queued membership suspension denies like');
 sql(`update public.tenant_memberships set status='active'where tenant_id='${tenant}'and user_id='${user(704)}';`);
 await pair(`update public.tenants set status='suspended'where id='${tenant}';`,identity(704)+save(10,'view',target),'42501','queued company suspension denies view');
 sql(`update public.tenants set status='active'where id='${tenant}';`);
 await pair(`delete from public.updates_recipients where tenant_id='${tenant}'and post_id='${post}'and actor_id='${user(705)}';`,identity(705)+save(11,'view',target),'42501','recipient removal serialized before view denies engagement');
 await pair(`update auth.users set email_confirmed_at=null where id='${user(704)}';`,identity(704)+save(12,'confirm',target),'42501','queued Auth confirmation revocation denies confirm');
 sql(`update auth.users set email_confirmed_at=now()where id='${user(704)}';`);
 await pair(`update public.tenant_memberships set role='manager'where tenant_id='${tenant}'and user_id='${user(701)}';`,identity(701)+save(1,'create',d),'42501','queued admin downgrade denies committed creation replay');
 sql(`update public.tenant_memberships set role='owner'where tenant_id='${tenant}'and user_id='${user(701)}';`);
 const newDraft=query(identity(701)+save(13,'create',d));const pid=JSON.parse(newDraft.split('\n').at(-1)).postId;
 await pair(`update public.tenant_memberships set status='suspended'where tenant_id='${tenant}'and user_id='${user(705)}';`,identity(701)+save(14,'publish',`jsonb_build_object('postId','${pid}','revision',1)`),'42501','queued recipient suspension prevents initial publication');
 if(query(`select status from public.updates_posts where id='${pid}'`)!=='draft'||query(`select count(*) from public.updates_comments where post_id='${post}'`)!=='1')throw Error('Denied races changed retained rows');checks.push('PASS: denied races retain draft and existing comment');
 return checks;
}
