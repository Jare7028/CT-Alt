import test from 'node:test';
import assert from 'node:assert/strict';
import {parseUpdatesQuery,parseUpdatesRosterQuery,parseUpdateDetailsQuery,parseUpdateRecipientsQuery,updatesMutation,decodeUpdatesCursor,readUpdates,readUpdateDetails,readUpdatesRoster,readUpdateRecipients,saveUpdate} from '../../lib/updates.ts';
const tenantId='77000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000701',other='00000000-0000-4000-8000-000000000704',postId='78000000-0000-4000-8000-000000000001',operationId='79000000-0000-4000-8000-000000000001',commentId='7a000000-0000-4000-8000-000000000001';
const post={id:postId,tenant_id:tenantId,title:'Synthetic title',body:'Synthetic body',status:'published',revision:2,content_revision:1,created_by:actorId,created_name:'Synthetic owner',created_at:'2026-10-03T23:00:00.123456+00:00',published_at:'2026-10-03T23:00:01.123456+00:00',allowComments:true,allowReactions:true,requireConfirmation:true,recipientCount:2,viewedCount:0,confirmedCount:0,likeCount:0,commentCount:0,liked:false,viewedAt:null,confirmedAt:null,canEdit:false,canPublish:false,canArchive:true,canRestore:false,canEngage:true,isRecipient:true};
const identity={tenantId,actorId,role:'owner'},company={id:tenantId,name:'Synthetic A',time_zone:'Europe/London'};
const result={company,role:'owner',actorId,capabilities:{canManage:true},posts:[post],counts:{total:1505,draft:5,published:1500,archived:0},nextCursor:null,serverTime:'2026-10-03T23:00:02+00:00'};
const q={tenantId,view:'feed',status:'all',search:'',limit:50};
const details={...identity,post,recipients:[{id:actorId,name:'Synthetic owner'},{id:other,name:'Synthetic employee'}],comments:[],nextCommentsCursor:null,serverTime:result.serverTime};
function access(posts=[post],extra={}){return {actorId,role:'owner',postStatus:null,contentRevision:null,postRevision:null,isRecipient:false,posts:posts.map(p=>({id:p.id,status:p.status,revision:p.revision,contentRevision:p.content_revision,isRecipient:p.isRecipient})),...extra};}
function fixture(data=result,check=access(),error=null,checkError=null){const calls=[];return {calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return name==='read_updates_access'?{data:check,error:checkError}:{data,error};}}};}
const rejects=(p,status=503)=>assert.rejects(p,e=>e.status===status);
const encode=c=>Buffer.from(JSON.stringify(c)).toString('base64url');
const scope={tenantId,actorId,role:'owner',kind:'feed',postId:null,status:'all',search:'',contentRevision:null,postRevision:null};
const boundary={scope,id:postId,position:'2026-10-03T23:00:01.123456Z'};
const draft={action:'create',title:'Title',body:'Body',recipientIds:[other],allowComments:true,allowReactions:true,requireConfirmation:true};
test('Updates filters are explicit literal and bounded; details analytics picker scopes distinct',()=>{
 assert.deepEqual(parseUpdatesQuery(new URLSearchParams({tenantId,search:' %_ '})),{...q,search:'%_'});
 for(const extra of [{tenantId:'invalid'},{limit:'0'},{limit:'101'},{search:'x'.repeat(101)},{view:'all'},{status:'anything'},{kind:'detail'},{cursor:'()'}])assert.throws(()=>parseUpdatesQuery(new URLSearchParams({tenantId,...extra})),e=>e.status===400);
 assert.throws(()=>parseUpdatesQuery(new URLSearchParams(`tenantId=${tenantId}&search=a&search=b`)),e=>e.status===400);
 assert.equal(parseUpdatesRosterQuery(new URLSearchParams({tenantId,search:'Synthetic'})).limit,50);
 assert.equal(parseUpdateDetailsQuery(new URLSearchParams({tenantId}),postId).postId,postId);
 assert.equal(parseUpdateRecipientsQuery(new URLSearchParams({tenantId,status:'unconfirmed'}),postId).status,'unconfirmed');
});
test('Draft/engagement/comment UUID payloads strictly bounded and reject server fields or stale identity shape',()=>{
 const parse=change=>updatesMutation.safeParse({tenantId,operationId,change}).success;
 assert.ok(parse(draft));assert.ok(parse({...draft,recipientIds:Array.from({length:500},(_,i)=>`00000000-0000-4000-8000-${String(i).padStart(12,'0')}`)}));
 for(const bad of [{...draft,recipientIds:[]},{...draft,recipientIds:[other,other]},{...draft,recipientIds:Array(501).fill(other)},{...draft,created_at:'now'},{...draft,title:'x'.repeat(161)},{...draft,body:'x'.repeat(5001)},{action:'view',postId,contentRevision:0},{action:'comment',postId,contentRevision:1,body:' '},{action:'edit_comment',postId,contentRevision:1,commentId,revision:1.5,body:'x'}])assert.equal(parse(bad),false);
});
test('One exact snapshot read plus fresh signed batched post scope check has no read-marking commands',async()=>{
 const f=fixture();const d=await readUpdates(f.client,q);assert.equal(d.counts.total,1505);assert.equal(d.posts[0].viewedAt,null);
 assert.deepEqual(f.calls.map(c=>c.name),['read_updates','read_updates_access']);assert.equal(f.calls[0].args.read_kind,'feed');assert.deepEqual(f.calls[1].args.target_posts,[postId]);
});
test('Missing, fractional, unsafe or incoherent counts and malformed capability/tenant data fail closed',async()=>{
 for(const counts of [{},{total:0,draft:0,published:0},{total:1505,draft:5,published:1499,archived:0},{total:Number.MAX_SAFE_INTEGER+1,draft:0,published:Number.MAX_SAFE_INTEGER+1,archived:0},{total:0.5,draft:0,published:0.5,archived:0}])await rejects(readUpdates(fixture({...result,counts}).client,q));
 for(const changed of [{actorId:other},{company:{...company,id:other}},{capabilities:{canManage:false}},{posts:[{...post,confirmedCount:1}]},{posts:[{...post,status:'draft'}]},{posts:[{...post,canEdit:true}]},{posts:[{...post,tenant_id:other}]}])await rejects(readUpdates(fixture({...result,...changed}).client,q));
 await rejects(readUpdates(fixture({...result,company:{...company,time_zone:'Factory'}}).client,q));
});
test('Fresh revoked recipient, changed actor/role/post revision and failed checks cannot return earlier data',async()=>{
 for(const check of [access([]),access([post],{actorId:other}),access([post],{role:'employee'}),access([{...post,isRecipient:false}]),access([{...post,status:'archived'}]),access([{...post,revision:3}])])await rejects(readUpdates(fixture(result,check).client,q),403);
 await rejects(readUpdates(fixture(result,null,null,{code:'XX000',message:'private detail'}).client,q));
 await rejects(readUpdates(fixture(null,null,{code:'42501'}).client,q),403);
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejects(readUpdates(f.client,q),401);assert.equal(f.calls.length,0);
});
test('Opaque precise cursor stays actor/tenant/filter scoped and output boundary validated',async()=>{
 const f=fixture({...result,nextCursor:boundary});const data=await readUpdates(f.client,{...q,limit:1});assert.deepEqual(decodeUpdatesCursor(data.nextCursor),boundary);assert.equal(decodeUpdatesCursor(data.nextCursor).position,'2026-10-03T23:00:01.123456Z');
 for(const patch of [{actorId:other},{tenantId:other},{search:'other'},{kind:'manage'},{postId}]){const f=fixture();await rejects(readUpdates(f.client,{...q,cursor:encode({...boundary,scope:{...scope,...patch}})}),400);assert.equal(f.calls.length,0);}
 for(const c of [{...boundary,id:other},{...boundary,scope:{...scope,actorId:other}}])await rejects(readUpdates(fixture({...result,nextCursor:c}).client,{...q,limit:1}));
 for(const c of ['garbage','unsafe()',encode({...boundary,id:'bad'}),encode({...boundary,private:'secret'})])assert.throws(()=>decodeUpdatesCursor(c),e=>e.status===400);
});
test('Details/roster/analytics identity rechecks, private recipients and comment scopes are exact',async()=>{
 const a=access([post],{postStatus:'published',contentRevision:1,postRevision:2,isRecipient:true});assert.equal((await readUpdateDetails(fixture(details,a).client,{tenantId,postId,limit:50})).recipients.length,2);
 await rejects(readUpdateDetails(fixture({...details,actorId:other},a).client,{tenantId,postId,limit:50}));
 const roster={...identity,users:[{id:other,name:'Synthetic employee'}],nextCursor:null};assert.equal((await readUpdatesRoster(fixture(roster,access([])).client,{tenantId,search:'',limit:50})).users.length,1);
 await rejects(readUpdatesRoster(fixture(roster,access([],{role:'manager'})).client,{tenantId,search:'',limit:50}),403);
 const analytics={...identity,recipients:[{actorId:other,name:'Synthetic',viewedAt:null,confirmedAt:null}],counts:{total:2,viewed:0,confirmed:0,likes:0,comments:0},nextCursor:null};assert.equal((await readUpdateRecipients(fixture(analytics,a).client,{tenantId,postId,status:'all',limit:50})).counts.total,2);
 for(const counts of [{},{total:2,viewed:0,confirmed:1,likes:0,comments:0},{total:2,viewed:0,confirmed:0,likes:3,comments:0}])await rejects(readUpdateRecipients(fixture({...analytics,counts},a).client,{tenantId,postId,status:'all',limit:50}));
});
test('All valid PostgreSQL nonBMP character bounds are accepted without truncation; true overflow rejected',async()=>{
 const p={...post,title:'😀'.repeat(160),body:'😀'.repeat(5000)};assert.equal((await readUpdates(fixture({...result,posts:[p]},access([p])).client,q)).posts[0].body.length,10000);
 for(const p of [{...post,title:'😀'.repeat(161)},{...post,body:'😀'.repeat(5001)}])await rejects(readUpdates(fixture({...result,posts:[p]}).client,q));
 const c={id:commentId,post_id:postId,actorId,author_name:'Synthetic',body:'😀'.repeat(2000),status:'active',revision:1,created_at:result.serverTime,updated_at:result.serverTime,canEdit:true,canRemove:true};const a=access([post],{postStatus:'published',contentRevision:1,postRevision:2});assert.equal((await readUpdateDetails(fixture({...details,comments:[c]},a).client,{tenantId,postId,limit:50})).comments[0].body.length,4000);
 await rejects(readUpdateDetails(fixture({...details,comments:[{...c,body:'😀'.repeat(2001)}]},a).client,{tenantId,postId,limit:50}));
});
test('Saved acknowledgements bind UUID/action/post/content/comment revisions and preserve exact retry payload',async()=>{
 const input={tenantId,operationId,change:{action:'comment',postId,contentRevision:1,body:'Synthetic'}};const saved={operationId,action:'comment',postId,revision:2,contentRevision:1,commentId,commentRevision:1};const f=fixture(saved);assert.deepEqual(await saveUpdate(f.client,input),saved);assert.deepEqual(f.calls[0].args.change,input.change);
 for(const patch of [{operationId:other},{action:'view'},{postId:other},{contentRevision:0},{commentRevision:2},{commentId:undefined}])await rejects(saveUpdate(fixture({...saved,...patch}).client,input));
 const life={tenantId,operationId,change:{action:'archive',postId,revision:2}};await rejects(saveUpdate(fixture({operationId,action:'archive',postId,revision:2,contentRevision:1}).client,life));
 await rejects(saveUpdate(fixture(null,null,{code:'40001'}).client,input),409);
});
test('SQL roster lowercase cursor is opaque across Turkish and nonBMP names, retaining actor role scope',async()=>{
 const name='İ😀',cursor={scope:{...scope,kind:'roster'},id:other,position:'i😀'};
 const roster={...identity,users:[{id:other,name}],nextCursor:cursor};const data=await readUpdatesRoster(fixture(roster,access([])).client,{tenantId,search:'',limit:1});assert.equal(data.users[0].name,name);assert.equal(decodeUpdatesCursor(data.nextCursor).position,'i😀');
 await rejects(readUpdatesRoster(fixture({...roster,nextCursor:{...cursor,scope:{...cursor.scope,role:'employee'}}},access([])).client,{tenantId,search:'',limit:1}));
});
test('Precise timestamp boundary, duplicate and reversed list/comment pages fail verification',async()=>{
 await rejects(readUpdates(fixture({...result,nextCursor:{...boundary,position:'2026-10-03T23:00:01.123457Z'}}).client,{...q,limit:1}));
 await rejects(readUpdates(fixture({...result,posts:[post,post]}).client,q));
 await rejects(readUpdates(fixture({...result,posts:[post]},access()).client,{...q,cursor:encode(boundary)}));
});
