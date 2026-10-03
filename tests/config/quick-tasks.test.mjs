import test from 'node:test';
import assert from 'node:assert/strict';
import {quickTaskMutation,parseQuickTaskQuery,decodeQuickTaskCursor,readQuickTasks,readQuickTask,saveQuickTask,parseQuickTaskAssigneesQuery,readQuickTaskAssignees} from '../../lib/quick-tasks.ts';
const tenantId='61000000-0000-4000-8000-000000000001',actorId='61000000-0000-4000-8000-000000000401',taskId='82000000-0000-4000-8000-000000000001',operationId='91000000-0000-4000-8000-000000000001';
const agentIds=['62000000-0000-4000-8000-000000000404','62000000-0000-4000-8000-000000000405'];
const details={title:'Shared inspection',description:'Original synthetic task',agentIds,startDate:null,dueDate:'2026-11-01'};
const mutation=change=>({tenantId,operationId,change});
const cursor={tenantId,actorId,agentId:null,tab:'all',status:'all',search:'',overdue:false,timeZone:'America/Havana',createdAt:'2026-11-01T04:30:00.123456+00:00',taskId};
const data={company:{id:tenantId,name:'Synthetic',time_zone:'America/Havana'},role:'owner',actorId,agent:null,capabilities:{canCreate:true,canViewAll:true,canManage:true},assignableAgents:[],assignableAgentsHasMore:false,assignableAgentsCursor:null,tasks:[],counts:{total:1500,open:1400,done:100,overdue:20},nextCursor:cursor,serverTime:'2026-11-01T04:30:00Z',timeZone:'America/Havana'};
function fixture(result=data,error=null){const calls=[];return {calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return {data:result,error};}}};}
const rejectsStatus=(promise,status)=>assert.rejects(promise,e=>e.status===status);
test('task mutation validates explicit assignment mode, calendar dates, bounds and server-owned completion',()=>{
 const create={action:'create',mode:'group',publication:'published',...details};
 assert.equal(quickTaskMutation.parse(mutation(create)).change.mode,'group');
 for(const extra of [{mode:undefined},{mode:'all'},{agentIds:[]},{agentIds:[...agentIds,agentIds[0]]},{agentIds:Array(26).fill(agentIds[0])},{title:' '},{title:'x'.repeat(151)},{description:'x'.repeat(5001)},{startDate:'2026-11-02'},{dueDate:'2026-02-30'},{dueDate:'0000-01-01'},{completed_at:'2026-11-01T00:00:00Z'}])assert.equal(quickTaskMutation.safeParse(mutation({...create,...extra})).success,false);
 assert.equal(quickTaskMutation.safeParse(mutation({action:'complete',taskId,revision:1,completed_by:actorId})).success,false);
 assert.equal(quickTaskMutation.safeParse(mutation({action:'complete',taskId,revision:0})).success,false);
 assert.equal(quickTaskMutation.safeParse(mutation({...create,agentIds:[agentIds[0],agentIds[0].toUpperCase()]})).success,false);
});
test('task filters and opaque cursors reject duplicate, unsupported and unsafe grammar and preserve microseconds',()=>{
 assert.deepEqual(parseQuickTaskQuery(new URLSearchParams({tenantId})),{tenantId,status:'all',search:'',overdue:false,limit:50});
 for(const query of [`tenantId=${tenantId}&tenantId=${actorId}`,`tenantId=${tenantId}&startDate=2026-11-01`,...Object.entries({limit:'101',status:'deleted',tab:'private',overdue:'yes',cursor:'x()',search:'x'.repeat(101)}).map(([key,value])=>new URLSearchParams({tenantId,[key]:value}).toString())])assert.throws(()=>parseQuickTaskQuery(new URLSearchParams(query)),e=>e.status===400);
 const encoded=Buffer.from(JSON.stringify(cursor)).toString('base64url');assert.equal(decodeQuickTaskCursor(encoded).createdAt,cursor.createdAt);
 for(const value of ['garbage','x()',Buffer.from(JSON.stringify({...cursor,createdAt:'infinity'})).toString('base64url'),Buffer.from(JSON.stringify({...cursor,private:true})).toString('base64url')])assert.throws(()=>decodeQuickTaskCursor(value),e=>e.status===400);
});
test('exact count snapshot uses one signed RPC and forwards scoped keyset cursor without directory truncation',async()=>{
 const f=fixture();const query=parseQuickTaskQuery(new URLSearchParams({tenantId,limit:'2',search:'%_'}));const result=await readQuickTasks(f.client,query);
 assert.equal(result.counts.total,1500);assert.equal(result.counts.done,100);assert.equal(decodeQuickTaskCursor(result.nextCursor).createdAt,cursor.createdAt);
 assert.deepEqual(f.calls,[{name:'read_quick_tasks',args:{target_tenant:tenantId,view_tab:null,state_filter:'all',search_text:'%_',overdue_only:false,page_limit:2,after_task:null}}]);
 const next=fixture();await readQuickTasks(next.client,{...query,cursor:result.nextCursor});assert.deepEqual(next.calls[0].args.after_task,cursor);
});
test('failed current access and reads never produce empty success; unsupported browser timezones denied',async()=>{
 for(const [code,status] of [['42501',403],['40001',409],['22023',400],['XX000',503]])await rejectsStatus(readQuickTasks(fixture(null,{code,message:'private internal text'}).client,parseQuickTaskQuery(new URLSearchParams({tenantId}))),status);
 for(const malformed of [null,{...data,counts:{total:-1}},{...data,counts:{total:0.5}},{...data,counts:{}},{...data,counts:{total:1,open:1,done:1,overdue:0}},{...data,counts:{total:1,open:1,done:0,overdue:2}},{...data,counts:{total:Number.MAX_SAFE_INTEGER+1,open:Number.MAX_SAFE_INTEGER+1,done:0,overdue:0}},{...data,assignableAgentsHasMore:undefined},{...data,assignableAgentsHasMore:true},{...data,assignableAgentsCursor:undefined},{...data,assignableAgentsCursor:{}},...['Factory','posixrules','right/UTC','Invalid/Zone'].map(timeZone=>({...data,timeZone}))])await rejectsStatus(readQuickTasks(fixture(malformed).client,parseQuickTaskQuery(new URLSearchParams({tenantId}))),503);
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejectsStatus(readQuickTasks(f.client,parseQuickTaskQuery(new URLSearchParams({tenantId}))),401);assert.equal(f.calls.length,0);
});
test('mutation acknowledgements bind operation, action, target, revision and independent row count',async()=>{
 const payload=mutation({action:'complete',taskId,revision:3});const ack={operationId,action:'complete',tasks:[{id:taskId,revision:4}]};const f=fixture(ack);assert.deepEqual(await saveQuickTask(f.client,payload),ack);assert.deepEqual(f.calls[0],{name:'save_quick_task',args:{target_tenant:tenantId,operation_id:operationId,change:payload.change}});
 for(const bad of [{...ack,operationId:actorId},{...ack,action:'archive'},{...ack,tasks:[{id:actorId,revision:4}]},{...ack,tasks:[{id:taskId,revision:3}]},{...ack,tasks:[]}])await rejectsStatus(saveQuickTask(fixture(bad).client,payload),503);
 const separate=mutation({action:'create',mode:'separate',publication:'draft',...details});const rows={operationId,action:'create',tasks:[{id:taskId,revision:1},{id:actorId,revision:1}]};assert.deepEqual(await saveQuickTask(fixture(rows).client,separate),rows);await rejectsStatus(saveQuickTask(fixture({...rows,tasks:[rows.tasks[0]]}).client,separate),503);await rejectsStatus(saveQuickTask(fixture({...rows,tasks:[rows.tasks[0],rows.tasks[0]]}).client,separate),503);
});
test('detail reads remain tenant-scoped and validate acknowledged target',async()=>{
 const result={task:{id:taskId},timeZone:'UTC',serverTime:'2026-11-01T00:00:00Z'};const f=fixture(result);assert.deepEqual(await readQuickTask(f.client,tenantId,taskId),result);assert.deepEqual(f.calls[0],{name:'read_quick_tasks',args:{target_tenant:tenantId,detail_id:taskId}});
 await rejectsStatus(readQuickTask(fixture({...result,task:{id:actorId}}).client,tenantId,taskId),503);await rejectsStatus(readQuickTask(fixture().client,tenantId,'bad'),400);
});

test('assignee reader is bounded, scope-bound and safe with search and keyset',async()=>{
 const next={tenantId,actorId,search:'Synthetic',name:'synthetic assignee',agentId:agentIds[0]};const result={agents:[{id:agentIds[0],name:'Synthetic assignee'}],nextCursor:next};const f=fixture(result);
 const query=parseQuickTaskAssigneesQuery(new URLSearchParams({tenantId,search:'Synthetic',limit:'1'}));const loaded=await readQuickTaskAssignees(f.client,query);assert.deepEqual(f.calls[0],{name:'read_quick_task_assignees',args:{target_tenant:tenantId,search_text:'Synthetic',page_limit:1,after_agent:null}});
 const second=fixture({agents:[],nextCursor:null});await readQuickTaskAssignees(second.client,{...query,cursor:loaded.nextCursor});assert.deepEqual(second.calls[0].args.after_agent,next);
 await rejectsStatus(readQuickTaskAssignees(fixture(null,{code:'42501'}).client,query),403);
 await rejectsStatus(readQuickTaskAssignees(fixture({...result,agents:[...result.agents,...result.agents]}).client,query),503);
 for(const extra of [{limit:'101'},{search:'x'.repeat(101)},{tab:'all'},{cursor:'unsafe()'}])assert.throws(()=>parseQuickTaskAssigneesQuery(new URLSearchParams({tenantId,...extra})),e=>e.status===400);
});

test('initial roster cursor continues beyond initial100 without fetching the first page again',async()=>{
 const rosterCursor={tenantId,actorId,search:'',name:'synthetic boundary',agentId:agentIds[0]};
 const initial=await readQuickTasks(fixture({...data,assignableAgentsHasMore:true,assignableAgentsCursor:rosterCursor}).client,parseQuickTaskQuery(new URLSearchParams({tenantId})));
 assert.equal(typeof initial.assignableAgentsCursor,'string');
 const f=fixture({agents:[{id:agentIds[1],name:'Synthetic next user'}],nextCursor:null});
 const more=await readQuickTaskAssignees(f.client,{tenantId,search:'',limit:100,cursor:initial.assignableAgentsCursor});
 assert.deepEqual(f.calls[0].args.after_agent,rosterCursor);assert.equal(more.agents[0].id,agentIds[1]);
 for(const changed of [{tenantId:actorId},{actorId:taskId},{search:'other'}])await rejectsStatus(readQuickTasks(fixture({...data,assignableAgentsHasMore:true,assignableAgentsCursor:{...rosterCursor,...changed}}).client,parseQuickTaskQuery(new URLSearchParams({tenantId}))),503);
});
