import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
registerHooks({ resolve(s,c,n) { return c.parentURL?.includes('/lib/') && s.startsWith('./') && !s.endsWith('.ts') ? n(new URL(s+'.ts',c.parentURL).href,c) : n(s,c); } });
const { rotaPublicationMutation, publishRotaShifts, readRotaPublicationBody } = await import('../../lib/rota-publication-server.ts');
const { formsParseJSON } = await import('../../lib/forms.ts');
const { ROTA_PUBLICATION_LIMITS: L } = await import('../../lib/rota-publication-types.ts');
const id = n => `88000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenantId=id(1),actorId=id(2),scheduleId=id(3);
const input={tenantId,scheduleId,scheduleRevision:7,shifts:[{id:id(4),revision:3},{id:id(5),revision:1}]};
const ack={schemaVersion:1,tenantId,actorId,schedule_id:scheduleId,schedule_revision:8,published_count:2,shifts:[{id:id(5),revision:2},{id:id(4),revision:4}]};
const access={schemaVersion:1,tenantId,actorId,schedule:{id:scheduleId,revision:8,time_zone:'Europe/London',status:'active'}};
function fixture(result=ack,current=access) {
 const calls=[];let auth=0;
 return {calls,client:{auth:{getUser:async()=>{calls.push('auth');auth++;return {data:{user:{id:actorId}},error:null};}},rpc:async(name,args)=>{calls.push({name,args});return {data:name==='read_rota_template_access'?current:result,error:null};}},get auth(){return auth;}};
}
const rejected=(p,status=503)=>assert.rejects(p,e=>e.status===status);
test('publication strict unique typed targets and increment-safe revisions',()=>{
 assert.deepEqual(rotaPublicationMutation.parse(input),input);
 for(const v of [{...input,extra:1},{...input,shifts:[]},{...input,scheduleRevision:0},{...input,scheduleRevision:2147483647},{...input,scheduleRevision:1.1},{...input,scheduleId:'bad'},{...input,shifts:[input.shifts[0],input.shifts[0]]},...['3',true,null,0,1.5,2147483647].map(revision=>({...input,shifts:[{id:id(4),revision}]})),{...input,shifts:[{id:id(4),revision:1,extra:1}]}]) assert.equal(rotaPublicationMutation.safeParse(v).success,false);
 const upper={...input,tenantId:tenantId.toUpperCase(),shifts:[{id:'88000000-0000-4000-8000-00000000000a',revision:1},{id:'88000000-0000-4000-8000-00000000000A',revision:1}]};assert.equal(rotaPublicationMutation.safeParse(upper).success,false);
});
test('publication permits exactly 5000 targets and rejects a 5001st',()=>{const v={...input,shifts:Array.from({length:L.shifts},(_,i)=>({id:id(100+i),revision:1}))};assert.equal(rotaPublicationMutation.safeParse(v).success,true);v.shifts.push({id:id(6000),revision:1});assert.equal(rotaPublicationMutation.safeParse(v).success,false);assert.ok(Buffer.byteLength(JSON.stringify(v))<L.requestBytes);});
test('invalid publication input never reaches Auth or mutation',async()=>{const f=fixture();await rejected(publishRotaShifts(f.client,{...input,shifts:[]}),400);assert.deepEqual(f.calls,[]);});
test('signed exact subset acknowledgement validates unordered targets and fresh access',async()=>{const f=fixture();assert.deepEqual(await publishRotaShifts(f.client,input),ack);assert.equal(f.auth,2);assert.deepEqual(f.calls,['auth',{name:'publish_rota_shifts',args:{target_tenant:tenantId,target_schedule:scheduleId,expected_revision:7,shift_rows:input.shifts}},'auth',{name:'read_rota_template_access',args:{target_tenant:tenantId,target_schedule:scheduleId}}]);});
test('exact acknowledgement scope count shape set and every revision fail closed',async()=>{
 for(const value of [null,{},...['tenantId','actorId','schedule_id'].map(k=>({...ack,[k]:id(99)})),{...ack,schedule_revision:9},{...ack,published_count:1},{...ack,published_count:2.5},{...ack,extra:1},{...ack,shifts:[ack.shifts[0],ack.shifts[0]]},{...ack,shifts:[{id:id(99),revision:2},ack.shifts[1]]},{...ack,shifts:[{...ack.shifts[0],revision:1},ack.shifts[1]]},{...ack,shifts:[{...ack.shifts[0],private:'hidden'},ack.shifts[1]]},{...ack,shifts:[ack.shifts[0]]}])await rejected(publishRotaShifts(fixture(value).client,input));
});
test('current access identity and monotonic acknowledged revision are validated',async()=>{
 for(const value of [null,{...access,actorId:id(99)},{...access,tenantId:id(99)},{...access,schedule:{...access.schedule,id:id(99)}},{...access,schedule:{...access.schedule,revision:7}},{...access,schedule:{...access.schedule,private:true}}])await rejected(publishRotaShifts(fixture(ack,value).client,input));
 assert.deepEqual(await publishRotaShifts(fixture(ack,{...access,schedule:{...access.schedule,revision:9,status:'archived'}}).client,input),ack);
});
test('missing anonymous and changed signed actor fail without exposing acknowledgement',async()=>{
 for(const [user,status]of[[null,401],[{id:actorId,is_anonymous:true},403]]){const f=fixture();f.client.auth.getUser=async()=>({data:{user},error:null});await rejected(publishRotaShifts(f.client,input),status);assert.equal(f.calls.length,0);}
 const f=fixture();let n=0;f.client.auth.getUser=async()=>({data:{user:{id:++n===1?actorId:id(99)}},error:null});await rejected(publishRotaShifts(f.client,input),403);assert.equal(f.calls.filter(x=>x.name==='read_rota_template_access').length,0);
});
test('current permission rejection after mutation returns no saved fields',async()=>{const f=fixture();f.client.rpc=async n=>n==='publish_rota_shifts'?{data:ack,error:null}:{data:null,error:{code:'42501'}};await rejected(publishRotaShifts(f.client,input),403);});
test('SQL rejection and unknown confirmation errors map conservatively with no retry',async()=>{for(const[code,status]of[['42501',403],['40001',409],['40P01',409],['23503',400],['22023',400],['XX000',503]]){const f=fixture();let n=0;f.client.rpc=async()=>{n++;return {data:null,error:{code}};};await rejected(publishRotaShifts(f.client,input),status);assert.equal(n,1);}});
test('publication body rejects duplicate keys malformed UTF8 and encoded duplicate fields',async()=>{
 for(const body of ['{"a":1,"a":2}','{"shifts":[{"id":"a","id":"b"}]}','{"a":1,"\\u0061":2}','{"a":',''])await rejected(readRotaPublicationBody(new Request('http://localhost',{method:'POST',body})),400);
 await rejected(readRotaPublicationBody(new Request('http://localhost',{method:'POST',body:new Uint8Array([0xc3,0x28])})),400);
 assert.deepEqual(await readRotaPublicationBody(new Request('http://localhost',{method:'POST',body:JSON.stringify(input)})),input);
});
test('publication body caps streamed bytes without a trusted content-length and cancels overflow',async()=>{
 let canceled=false;const stream=new ReadableStream({start(c){c.enqueue(new Uint8Array(L.requestBytes));c.enqueue(new Uint8Array(1));},cancel(){canceled=true;}});
 await rejected(readRotaPublicationBody(new Request('http://localhost',{method:'POST',body:stream,duplex:'half'})),413);assert.equal(canceled,true);
 for(const length of [String(L.requestBytes+1),'bad','-1'])await rejected(readRotaPublicationBody(new Request('http://localhost',{method:'POST',headers:{'content-length':length},body:'{}'})),413);
 const boundary=' '.repeat(L.requestBytes-2)+'{}';assert.deepEqual(await readRotaPublicationBody(new Request('http://localhost',{method:'POST',body:boundary})),{});
});

test('all 5000 streamed publication targets fit the larger caller bound while Forms default remains 256KiB',async()=>{const v={...input,shifts:Array.from({length:L.shifts},(_,i)=>({id:id(100+i),revision:2147483646}))},raw=JSON.stringify(v);assert.ok(Buffer.byteLength(raw)>262144);assert.ok(Buffer.byteLength(raw)<L.requestBytes);assert.deepEqual(await readRotaPublicationBody(new Request('http://localhost',{method:'POST',body:raw})),v);assert.throws(()=>formsParseJSON(raw),e=>e.status===413);});
