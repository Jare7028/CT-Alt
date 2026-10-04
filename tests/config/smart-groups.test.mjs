import test from 'node:test';
import assert from 'node:assert/strict';
import {parseSmartGroupsQuery,parseSmartGroupSegmentsQuery,parseSmartGroupMembersQuery,smartGroupMutation,smartGroupPreview,readSmartGroups,readSmartGroupSegments,readSmartGroupMembers,previewSmartGroup,saveSmartGroup,decodeSmartGroupsCursor} from '../../lib/smart-groups.ts';
const tenantId='88000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000901',segmentId='66000000-0000-4000-8000-000000000001',groupId='66000000-0000-4000-8000-000000000002',operationId='66000000-0000-4000-8000-000000000003',other='66000000-0000-4000-8000-000000000004';
const identity={tenantId,actorId,role:'owner',fieldFingerprint:'a'.repeat(32),datasetVersion:'b'.repeat(32)},fields=[{key:'title',label:'Title'},{key:'team',label:'Team'},{key:'custom:branch',label:'Branch'}],rules=[{field:'title',values:['Cook','cook']},{field:'custom:branch',values:[' New York ']}],counts={records:1005,unlinked:992,eligible:10,unavailable:3};
const segment={id:segmentId,name:'Organization',description:'',status:'active',revision:1,activeGroupCount:1,canArchive:false,canRestore:false},group={id:groupId,segmentId,name:'Cooks',description:'',status:'active',revision:1,rules,needsReview:false,invalidFields:[],counts,canEdit:true,canArchive:true,canRestore:false};
const base={...identity,serverTime:'2026-10-04T01:00:00.123456Z',nextCursor:null},catalog={...base,company:{id:tenantId,name:'Synthetic',time_zone:'UTC'},fields,groups:[group],counts:{total:1,active:1,archived:0,needsReview:0}},members={...base,group,segment,fields,members:[{id:other,name:'İ Synthetic😀',title:'Cook',team:'North',linkStatus:'unlinked'}],counts,matchedCount:1005},preview={...base,fields,rules,members:members.members,counts,matchedCount:1005},segments={...base,segments:[segment],counts:{total:1,active:1,archived:0}};
const access={...identity,groups:[{id:groupId,segmentId,revision:1,status:'active'}],segments:[{id:segmentId,revision:1,status:'active'}]},query={tenantId,status:'active',search:'',limit:50};
function fixture(data=catalog,current=access,error=null,accessError=null){const calls=[];return{calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return name==='read_smart_groups_access'?{data:current,error:accessError}:{data,error};}}};}
const reject=(p,status=503)=>assert.rejects(p,e=>e.status===status);
test('Smart Groups strict singular queries/defaults, dynamic id and bounded filters',()=>{
 assert.deepEqual(parseSmartGroupsQuery(new URLSearchParams({tenantId})),query);assert.equal(parseSmartGroupSegmentsQuery(new URLSearchParams({tenantId})).status,'all');assert.equal(parseSmartGroupMembersQuery(new URLSearchParams({tenantId}),groupId).groupId,groupId);
 for(const p of [{tenantId,limit:'101'},{tenantId,limit:'1.5'},{tenantId,status:'draft'},{tenantId,search:'x'.repeat(101)},{tenantId,segmentId:'bad'},{tenantId,unknown:'x'},{tenantId:'bad'}])assert.throws(()=>parseSmartGroupsQuery(new URLSearchParams(p)),e=>e.status===400);
 assert.throws(()=>parseSmartGroupsQuery(new URLSearchParams(`tenantId=${tenantId}&status=all&status=all`)),e=>e.status===400);assert.throws(()=>parseSmartGroupMembersQuery(new URLSearchParams({tenantId}),'bad'),e=>e.status===400);
});
test('Rules enforce AND1..10 OR1..25, preserve literals and reject broadcast/path/duplicates/whitespace/UTF16 overflow',()=>{
 const change={action:'create_group',segmentId,name:'Cooks',description:'',rules};assert.deepEqual(smartGroupMutation.parse({tenantId,operationId,change}).change.rules,rules);
 for(const rules of [[],[{field:'title',values:[]}],[{field:'title',values:['x','x']}],[{field:'title',values:['\t']}],[{field:'title',values:['\u00a0']}],[{field:'user_id',values:['x']}],[{field:'custom:../x',values:['x']}],[{field:'title',values:['😀'.repeat(251)]}],Array.from({length:11},()=>({field:'title',values:['x']})),[{field:'title',values:Array.from({length:26},(_,i)=>String(i))}],[{field:'title',values:['x'],operator:'contains'}]])assert.equal(smartGroupMutation.safeParse({tenantId,operationId,change:{...change,rules}}).success,false,JSON.stringify(rules));
 assert.equal(smartGroupPreview.safeParse({tenantId,rules:[{field:'title',values:['😀'.repeat(250)]}]}).success,true);assert.equal(smartGroupMutation.safeParse({tenantId,operationId,change:{...change,revision:1}}).success,false);
});
test('Signed owner catalog exact counts and one stable read plus fresh scoped access, no writes',async()=>{
 const f=fixture();assert.equal((await readSmartGroups(f.client,query)).groups[0].counts.records,1005);assert.deepEqual(f.calls.map(c=>c.name),['read_smart_groups','read_smart_groups_access']);assert.equal(f.calls[0].args.page_limit,50);assert.deepEqual(f.calls[1].args.group_ids,[groupId]);assert.deepEqual(f.calls[1].args.segment_ids,[segmentId]);
 assert.equal((await readSmartGroupSegments(fixture(segments).client,{...query,status:'all'})).segments[0].name,'Organization');assert.equal((await readSmartGroupMembers(fixture(members).client,{tenantId,groupId,search:'',limit:50})).matchedCount,1005);assert.deepEqual((await previewSmartGroup(fixture(preview).client,{tenantId,rules})).rules,rules);
});
test('Missing fractional unsafe incoherent counts and private/foreign/role fields never become successful zeros',async()=>{
 for(const patch of [{counts:{}},{counts:{total:1,active:1,archived:0}},{counts:{total:2,active:1,archived:0,needsReview:0}},{counts:{total:1.5,active:1.5,archived:0,needsReview:0}},{counts:{total:Number.MAX_SAFE_INTEGER+1,active:Number.MAX_SAFE_INTEGER+1,archived:0,needsReview:0}},{counts:{total:1,active:1,archived:0,needsReview:2}},{actorId:other},{tenantId:other},{role:'manager'},{company:{...catalog.company,id:other}},{privateNote:'private'},{groups:[{...group,counts:{records:1005,unlinked:992,eligible:10,unavailable:2}}]}])await reject(readSmartGroups(fixture({...catalog,...patch}).client,query));
 for(const patch of [{matchedCount:1006},{matchedCount:null},{counts:{records:1005,unlinked:1005,eligible:1,unavailable:0}},{members:[members.members[0],members.members[0]]},{members:[{...members.members[0],email:'private'}]}])await reject(readSmartGroupMembers(fixture({...members,...patch}).client,{tenantId,groupId,search:'',limit:50}));
});
test('Removed custom field is explicit review with null counts and no partial membership; response fields bind definition',async()=>{
 const invalidGroup={...group,needsReview:true,invalidFields:['custom:branch'],counts:null,canRestore:false},d={...members,fields:fields.slice(0,2),group:invalidGroup,members:[],counts:null,matchedCount:null};assert.equal((await readSmartGroupMembers(fixture(d).client,{tenantId,groupId,search:'',limit:50})).group.needsReview,true);
 for(const patch of [{members:members.members},{counts},{matchedCount:0},{group:{...invalidGroup,invalidFields:[]}},{fields}])await reject(readSmartGroupMembers(fixture({...d,...patch}).client,{tenantId,groupId,search:'',limit:50}));
});
test('Successful preview binds exact echoed rules and registered fields; Unicode stored SQL limits accepted',async()=>{
 await reject(previewSmartGroup(fixture({...preview,rules:[{field:'team',values:['North']}]}).client,{tenantId,rules}));await reject(previewSmartGroup(fixture({...preview,fields:fields.slice(0,2)}).client,{tenantId,rules}));
 assert.equal((await readSmartGroups(fixture({...catalog,groups:[{...group,name:'😀'.repeat(100),description:'😀'.repeat(500)}]}).client,query)).groups[0].name.length,200);
 await reject(readSmartGroups(fixture({...catalog,groups:[{...group,name:'😀'.repeat(101)}]}).client,query));
});
test('Fresh revocation and failed access recheck deny; role/identity differences403 and definition/population changes409',async()=>{
 for(const patch of [{actorId:other},{tenantId:other},{role:'admin'}])await reject(readSmartGroups(fixture(catalog,{...access,...patch}).client,query),403);
 for(const patch of [{datasetVersion:'c'.repeat(32)},{fieldFingerprint:'c'.repeat(32)},{groups:[]},{groups:[{...access.groups[0],revision:2}]},{groups:[{...access.groups[0],status:'archived'}]}])await reject(readSmartGroups(fixture(catalog,{...access,...patch}).client,query),409);
 await reject(readSmartGroups(fixture(catalog,null,null,{code:'42501'}).client,query),403);await reject(readSmartGroups(fixture(catalog,null,null,{code:'XX000',message:'private'}).client,query));await reject(readSmartGroups(fixture(catalog,{}).client,query));
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await reject(readSmartGroups(f.client,query),401);assert.equal(f.calls.length,0);
});
test('Opaque SQL name cursor preserves Turkish sort position without JS lowercase, rejects false scope/continuation',async()=>{
 const q={...query,limit:1},scope={...identity,kind:'groups',groupId:null,segmentId:null,status:'active',search:'',rulesFingerprint:null,groupRevision:null},nextCursor={scope,id:groupId,position:'i'},d={...catalog,groups:[{...group,name:'İ'}],nextCursor};const out=await readSmartGroups(fixture(d).client,q);assert.equal(decodeSmartGroupsCursor(out.nextCursor).position,'i');
 for(const n of [{...nextCursor,id:other},{...nextCursor,scope:{...scope,actorId:other}},{...nextCursor,scope:{...scope,datasetVersion:'c'.repeat(32)}},{...nextCursor,scope:{...scope,kind:'members'}}])await reject(readSmartGroups(fixture({...d,nextCursor:n}).client,q));
 assert.throws(()=>decodeSmartGroupsCursor('!bad'),e=>e.status===400);const foreign=Buffer.from(JSON.stringify({...nextCursor,scope:{...scope,actorId:other}})).toString('base64url');await reject(readSmartGroups(fixture().client,{...query,cursor:foreign}),400);
});
test('Precise management acknowledgement checks action/ids/revision and excludes unexpected group identities',async()=>{
 const change={action:'create_segment',name:'Organization',description:''},input={tenantId,operationId,change},saved={operationId,action:change.action,segmentId,revision:1};assert.deepEqual(await saveSmartGroup(fixture(saved).client,input),saved);
 for(const patch of [{operationId:other},{action:'edit_segment'},{revision:2},{groupId}])await reject(saveSmartGroup(fixture({...saved,...patch}).client,input));const edit={...input,change:{action:'edit_group',groupId,segmentId,revision:2,name:'Cooks',description:'',rules}};await reject(saveSmartGroup(fixture({operationId,action:'edit_group',groupId,segmentId,revision:2}).client,edit));
});
test('Database failures map private status without diagnostics; malformed snapshots never masquerade as empty success',async()=>{
 for(const[code,status]of [['42501',403],['40001',409],['22023',400],['22P02',400],['XX000',503]])await assert.rejects(readSmartGroups(fixture(null,null,{code,message:'private SQL diagnostic'}).client,query),e=>e.status===status&&!e.message.includes('private'));
 for(const data of [null,{},[],{...catalog,groups:null}])await reject(readSmartGroups(fixture(data).client,query));
});
