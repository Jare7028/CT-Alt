import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTimeOffQuery,timeOffMutation,timeOffCalendarDays,decodeTimeOffCursor,readTimeOff,saveTimeOff} from '../../lib/time-off.ts';
const tenantId='81000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000804',agentId='84000000-0000-4000-8000-000000000804',typeId='86000000-0000-4000-8000-000000000001',requestId='88000000-0000-4000-8000-000000000001',operationId='87000000-0000-4000-8000-000000000001';
const query={tenantId,view:'mine',status:'all',search:'',limit:1};
const access={company:{id:tenantId,name:'Synthetic',time_zone:'Europe/London'},role:'employee',actorId,agent:{id:agentId,name:'Synthetic worker'}};
const at='2026-10-03T12:00:00.123456+00:00';
const request={id:requestId,tenant_id:tenantId,agent_id:agentId,agent_name:'Synthetic worker',type_id:typeId,type_name:'Vacation',type_description:'Retained snapshot',type_paid:true,start_date:'2026-10-24',end_date:'2026-10-26',calendar_days:3,note:'Private synthetic note',status:'pending',revision:1,requested_by:actorId,requested_at:at,decision_by:null,decision_name:null,decision_reason:null,decided_at:null,history:[{action:'request',actor_name:'Synthetic requester',occurred_at:at,revision:1,reason:null}],canWithdraw:true,canApprove:false,canReject:false,canCancel:false};
const cursor={tenantId,actorId,agentId,role:'employee',view:'mine',status:'all',search:'',filterAgent:null,typeId:null,startDate:null,endDate:null,timeZone:'Europe/London',requestedAt:at,requestId};
const result={...access,types:[{id:typeId,name:'Vacation',description:'Retained snapshot',paid:true,status:'active',revision:1,canArchive:false}],requests:[request],counts:{total:1505,pending:1500,approved:2,rejected:1,withdrawn:1,cancelled:1},nextCursor:cursor,serverTime:at,timeZone:'Europe/London',capabilities:{canRequest:true,canManageTypes:false,canViewTeam:false}};
function fixture(data=result,error=null,fresh=access,accessError=null){const calls=[];return {calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return name==='read_time_off_access'?{data:fresh,error:accessError}:{data,error};}}};}
const rejectStatus=(promise,status)=>assert.rejects(promise,e=>e.status===status);
const mutation=change=>({tenantId,operationId,change});
const details={action:'request',agentId,typeId,startDate:'2026-10-24',endDate:'2026-10-26',note:''};
test('full calendar labels count inclusive days across DST and skipped dates without elapsed/balance calculation',()=>{
 assert.equal(timeOffCalendarDays('2026-10-24','2026-10-26'),3);assert.equal(timeOffCalendarDays('2026-03-07','2026-03-09'),3);assert.equal(timeOffCalendarDays('2011-12-29','2011-12-31'),3);assert.equal(timeOffCalendarDays('2028-01-01','2028-12-31'),366);assert.equal(timeOffCalendarDays('0001-01-01','0001-01-01'),1);
});
test('mutations reject client identities/times, reversed/nonexistent/unbounded dates and missing captured agent',()=>{
 assert.equal(timeOffMutation.parse(mutation(details)).change.agentId,agentId);
 for(const extra of [{agentId:undefined},{requested_by:actorId},{requested_at:at},{startDate:'2026-02-30'},{startDate:'0000-01-01'},{startDate:'2026-10-27'},{startDate:'2026-01-01',endDate:'2027-01-02'},{note:'x'.repeat(2001)}])assert.equal(timeOffMutation.safeParse(mutation({...details,...extra})).success,false);
 assert.equal(timeOffMutation.parse(mutation({action:'approve',requestId,revision:1})).change.reason,'');
 for(const action of ['reject','cancel'])assert.equal(timeOffMutation.safeParse(mutation({action,requestId,revision:1,reason:' '})).success,false);
 assert.equal(timeOffMutation.safeParse(mutation({action:'archive_type',typeId,revision:0})).success,false);
});
test('query filters are bounded and explicit; paired date filters select inclusive overlapping calendar ranges',()=>{
 assert.deepEqual(parseTimeOffQuery(new URLSearchParams({tenantId})),{tenantId,view:'mine',status:'all',search:'',limit:50});
 for(const extra of [{startDate:'2026-10-03'},{startDate:'2026-10-04',endDate:'2026-10-03'},{startDate:'2026-01-01',endDate:'2027-01-02'},{view:'all'},{status:'deleted'},{limit:'101'},{search:'x'.repeat(101)},{calendarHours:'8'},{cursor:'unsafe()'}])assert.throws(()=>parseTimeOffQuery(new URLSearchParams({tenantId,...extra})),e=>e.status===400);
 assert.throws(()=>parseTimeOffQuery(new URLSearchParams(`tenantId=${tenantId}&tenantId=${actorId}`)),e=>e.status===400);
});
test('snapshot uses exact uncapped count and safe scoped keyset plus fresh current-access RPC',async()=>{
 const f=fixture();const data=await readTimeOff(f.client,query);assert.equal(data.counts.total,1505);assert.equal(data.requests[0].requested_at,at);assert.deepEqual(decodeTimeOffCursor(data.nextCursor),cursor);
 assert.deepEqual(f.calls,[{name:'read_time_off',args:{target_tenant:tenantId,view_mode:'mine',state_filter:'all',search_text:'',page_limit:1,filter_agent:null,filter_type:null,start_date:null,end_date:null,after_request:null}},{name:'read_time_off_access',args:{target_tenant:tenantId}}]);
 for(const bad of ['garbage','unsafe()',Buffer.from(JSON.stringify({...cursor,requestedAt:'infinity'})).toString('base64url')])assert.throws(()=>decodeTimeOffCursor(bad),e=>e.status===400);
});
test('missing, unsafe/incoherent counts, wrong identity and malformed cursor/zone never become empty successes',async()=>{
 for(const data of [null,{},...[-1,0.5,Number.MAX_SAFE_INTEGER+1].map(total=>({...result,counts:{...result.counts,total}})),{...result,counts:{}},{...result,counts:{...result.counts,pending:1499}},{...result,actorId:requestId},{...result,requests:[{...request,requested_by:requestId}]},{...result,requests:[{...request,calendar_days:2}]},{...result,nextCursor:{...cursor,actorId:requestId}},{...result,timeZone:'Factory'},{...result,company:{...result.company,time_zone:'posixrules'}}])await rejectStatus(readTimeOff(fixture(data).client,query),503);
});
test('revocation, agent relink and role change during long read withhold records; failed recheck remains an error',async()=>{
 for(const changed of [{...access,agent:{...access.agent,id:requestId}},{...access,role:'admin'},{...access,company:{...access.company,time_zone:'UTC'}}])await rejectStatus(readTimeOff(fixture(result,null,changed).client,query),403);
 await rejectStatus(readTimeOff(fixture(result,null,null,{code:'42501'}).client,query),403);await rejectStatus(readTimeOff(fixture(result,null,null,{code:'XX000'}).client,query),503);
 for(const [code,status] of [['42501',403],['40001',409],['22023',400],['XX000',503]])await rejectStatus(readTimeOff(fixture(null,{code}).client,query),status);
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejectStatus(readTimeOff(f.client,query),401);assert.equal(f.calls.length,0);
});
test('request UUID/agent payload stays fixed on retries and acknowledgements bind operation/action/target/revision',async()=>{
 const payload=mutation(details);const ack={operationId,action:'request',typeId,requestId,revision:1};const f=fixture(ack);assert.deepEqual(await saveTimeOff(f.client,payload),ack);assert.deepEqual(await saveTimeOff(f.client,payload),ack);assert.deepEqual(f.calls[0],f.calls[1]);assert.equal(f.calls[0].args.change.agentId,agentId);
 for(const bad of [{...ack,operationId:actorId},{...ack,action:'approve'},{...ack,typeId:actorId},{...ack,requestId:undefined},{...ack,revision:2}])await rejectStatus(saveTimeOff(fixture(bad).client,payload),503);
 const approval=mutation({action:'approve',requestId,revision:2,reason:''});await rejectStatus(saveTimeOff(fixture({...ack,action:'approve',revision:2}).client,approval),503);assert.equal((await saveTimeOff(fixture({...ack,action:'approve',revision:3}).client,approval)).revision,3);
});
