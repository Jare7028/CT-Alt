import test from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@supabase/supabase-js';
import {timeClockMutation,parseTimeClockQuery,decodeTimeClockCursor,readTimeClock,saveTimeClock,supportedTimeClockZone} from '../../lib/time-clock.ts';
const tenantId='10000000-0000-4000-8000-000000000001',actorId='10000000-0000-4000-8000-000000000002',jobId='10000000-0000-4000-8000-000000000003',entryId='10000000-0000-4000-8000-000000000004',operationId='10000000-0000-4000-8000-000000000005';
const cursor={tenantId,actorId,mode:'timesheets',timeZone:'Europe/London',startDate:'2026-10-25',endDate:'2026-10-25',today:null,startedAt:'2026-10-25T01:30:00.123456+00:00',entryId};
function fixture(data,error){const requests=[];const client=createClient('http://127.0.0.1:54821','synthetic-publishable-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(url,init)=>{
 requests.push({url:String(url),body:JSON.parse(init.body)});return new Response(JSON.stringify(error??data),{status:error?400:200,headers:{'Content-Type':'application/json'}});
 }}});client.auth.getUser=async()=>({data:{user:{id:actorId}},error:null});return {client,requests};}
test('clock mutation contract rejects client times, identities, unknown fields and invalid revisions',()=>{
 const payload={tenantId,operationId,change:{action:'clock_in',jobId}};assert.equal(timeClockMutation.safeParse(payload).success,true);
 for(const extra of [{started_at:'2026-10-03T10:00:00Z'},{agentId:actorId},{userId:actorId},{ended_at:null},{paid:true}])assert.equal(timeClockMutation.safeParse({...payload,change:{...payload.change,...extra}}).success,false);
 assert.equal(timeClockMutation.safeParse({...payload,actorId}).success,false);
 for(const revision of [0,-1,1.5,2147483648,'1'])assert.equal(timeClockMutation.safeParse({...payload,change:{action:'clock_out',entryId,revision}}).success,false);
 for(const name of ['', ' '.repeat(3),'x'.repeat(101)])assert.equal(timeClockMutation.safeParse({...payload,change:{action:'create_job',name}}).success,false);
 assert.equal(timeClockMutation.safeParse({...payload,change:{action:'create_job',name:'  Care  '}}).data.change.name,'Care');
 assert.equal(timeClockMutation.safeParse({...payload,change:{action:'break_start',entryId,revision:1,paid:'false'}}).success,false);
});
test('clock queries enforce bounded pages, inclusive valid dates and mode-specific filters',()=>{
 assert.deepEqual(parseTimeClockQuery(new URLSearchParams({tenantId})),{tenantId,mode:'status',limit:50});
 const history=parseTimeClockQuery(new URLSearchParams({tenantId,mode:'timesheets',limit:'100',startDate:'2026-10-25',endDate:'2026-10-25'}));assert.equal(history.limit,100);
 for(const extra of [{limit:'101'},{limit:'0'},{mode:'all'},{startDate:'2026-02-30',mode:'timesheets'},{startDate:'0000-01-01',mode:'timesheets'},{startDate:'2026-10-26',endDate:'2026-10-25',mode:'timesheets'},{mode:'attendance',startDate:'2026-10-25'},{cursor:'abc'},{unknown:'x'}])assert.throws(()=>parseTimeClockQuery(new URLSearchParams({tenantId,...extra})),error=>error.status===400);
 assert.throws(()=>parseTimeClockQuery(new URLSearchParams(`tenantId=${tenantId}&tenantId=${actorId}`)),error=>error.status===400);
});
test('clock cursor retains precise keyset timestamps and rejects malformed or arbitrary payloads',()=>{
 const encoded=Buffer.from(JSON.stringify(cursor)).toString('base64url');assert.deepEqual(decodeTimeClockCursor(encoded),cursor);assert.equal(decodeTimeClockCursor(),null);
 for(const payload of [{...cursor,startedAt:cursor.startedAt+'),id.gt.0'},{...cursor,entryId:'bad'},{...cursor,privatePayload:'not permitted'},{...cursor,today:'infinity'}])assert.throws(()=>decodeTimeClockCursor(Buffer.from(JSON.stringify(payload)).toString('base64url')),error=>error.status===400);
 for(const value of ['bad()', 'x'.repeat(1001),'not-json'])assert.throws(()=>decodeTimeClockCursor(value),error=>error.status===400);
});
test('history RPC carries company/date/keyset scope without fetching or mutating another user',async()=>{
 const f=fixture({entries:[],nextCursor:cursor,serverTime:'2026-10-03T12:00:00Z',timeZone:'Europe/London'});const encoded=Buffer.from(JSON.stringify(cursor)).toString('base64url');
 const data=await readTimeClock(f.client,{tenantId,mode:'timesheets',limit:50,startDate:'2026-10-25',endDate:'2026-10-25',cursor:encoded});
 assert.deepEqual(decodeTimeClockCursor(data.nextCursor),cursor);assert.deepEqual(f.requests[0].body,{target_tenant:tenantId,view_mode:'timesheets',page_limit:50,start_date:'2026-10-25',end_date:'2026-10-25',after_entry:cursor});assert.ok(f.requests[0].url.endsWith('/rpc/read_time_clock'));assert.equal(f.requests.length,1);
});
test('operation UUID and exact action survive RPC retries and acknowledgements verify identity/revision',async()=>{
 const payload={tenantId,operationId,change:{action:'break_end',entryId,revision:2}};const saved={operationId,action:'break_end',jobId,entryId,revision:3};
 const f=fixture(saved);assert.deepEqual(await saveTimeClock(f.client,payload),saved);assert.deepEqual(await saveTimeClock(f.client,payload),saved);assert.deepEqual(f.requests[0].body,f.requests[1].body);assert.deepEqual(f.requests[0].body,{target_tenant:tenantId,operation_id:operationId,change:payload.change});
 for(const changed of [{...saved,revision:2},{...saved,entryId:actorId},{...saved,operationId:actorId},{...saved,action:'clock_out'}])await assert.rejects(saveTimeClock(fixture(changed).client,payload),error=>error.status===503);
});
test('revoked/foreign permissions, conflicts and unreadable records are errors rather than empty clock state',async()=>{
 for(const [code,status] of [['42501',403],['P0002',404],['40001',409],['23505',409],['22023',400],['XX000',503]])await assert.rejects(readTimeClock(fixture(null,{code,message:'private internal error'}).client,{tenantId,mode:'status',limit:50}),error=>error.status===status&&!error.message.includes('private internal'));
 await assert.rejects(readTimeClock(fixture(null).client,{tenantId,mode:'status',limit:50}),error=>error.status===503);
 const f=fixture({});f.client.auth.getUser=async()=>({data:{user:null},error:null});await assert.rejects(readTimeClock(f.client,{tenantId,mode:'status',limit:50}),error=>error.status===401);assert.equal(f.requests.length,0);
});

test('unsupported PostgreSQL zone names never reach browser clock rendering',async()=>{
 for(const timeZone of ['Factory','posixrules','localtime','Invalid/Zone','posix/Europe/London','right/UTC']) {
  assert.equal(supportedTimeClockZone(timeZone),false);
  await assert.rejects(readTimeClock(fixture({jobs:[],entry:null,actorId,company:{time_zone:timeZone},serverTime:'2026-10-03T12:00:00Z'}).client,{tenantId,mode:'status',limit:50}),error=>error.status===503);
  await assert.rejects(readTimeClock(fixture({entries:[],nextCursor:null,timeZone,serverTime:'2026-10-03T12:00:00Z'}).client,{tenantId,mode:'timesheets',limit:50}),error=>error.status===503);
 }
 for(const timeZone of ['UTC','Europe/London','Asia/Kathmandu'])assert.equal(supportedTimeClockZone(timeZone),true);
});
