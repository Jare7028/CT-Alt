import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { createClient } from '@supabase/supabase-js';
// Match Next's extensionless TypeScript resolution in native Node test mode.
registerHooks({ resolve(specifier, context, next) {
 if (context.parentURL?.endsWith('/lib/team-timesheets.ts') && ['./csv','./time-clock'].includes(specifier)) return next(new URL(specifier+'.ts',context.parentURL).href,context);
 return next(specifier,context);
} });
const {parseTeamTimesheetQuery,decodeTeamTimesheetCursor,readTeamTimesheets,teamTimesheetCSV,teamTimesheetCSVStream}=await import('../../lib/team-timesheets.ts');
const tenantId='10000000-0000-4000-8000-000000000001',actorId='10000000-0000-4000-8000-000000000002',agentId='10000000-0000-4000-8000-000000000003',jobId='10000000-0000-4000-8000-000000000004',entryId='10000000-0000-4000-8000-000000000005';
const query={tenantId,startDate:'2026-10-25',endDate:'2026-10-25',agentId:null,mode:'review',limit:50};
const company={id:tenantId,name:'Synthetic company',time_zone:'Europe/London'};
const cursor={tenantId,actorId,startDate:query.startDate,endDate:query.endDate,agentId:null,timeZone:company.time_zone,datasetVersion:'9007199254740993',startedAt:'2026-10-25T01:30:00.123456+00:00',entryId};
const entry={id:entryId,tenant_id:tenantId,agent_id:agentId,agent_name:'Synthetic retained agent',job_id:jobId,job_name:'Synthetic work',started_at:cursor.startedAt,ended_at:'2026-10-25T02:30:00.123456+00:00',revision:4,elapsed_seconds:3600,unpaid_break_seconds:600,paid_seconds:3000};
const review={company,role:'owner',actorId,filters:{startDate:query.startDate,endDate:query.endDate,agentId:null},timeZone:company.time_zone,serverTime:'2026-10-26T10:00:00Z',datasetVersion:cursor.datasetVersion,
 summary:{entryCount:1204,agentCount:1,elapsedSeconds:4334400,unpaidBreakSeconds:722400,paidSeconds:3612000},agents:[{id:agentId,name:'Synthetic retained agent'}],entries:[entry],nextCursor:cursor,exportLimit:10000};
function fixture({data=review,role='owner',rpcCode,denied=false,revoke=false,changedRole,changedZone}={}) {
 const requests=[];let checks=0;
 const client=createClient('http://127.0.0.1:54821','synthetic-publishable-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(raw,init)=>{
  const url=new URL(String(raw)),table=url.pathname.split('/').at(-1);requests.push({table,url,method:init.method,body:init.body});
  const result=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(table==='tenant_memberships'){checks++;return result(denied||revoke&&checks>1?[]:[{role:checks>1&&changedRole?changedRole:role}]);}
  if(table==='tenants')return result(denied?[]:[{...company,status:'active',time_zone:checks>1&&changedZone?changedZone:company.time_zone}]);
  if(table==='read_team_timesheets')return rpcCode?result({code:rpcCode,message:'private internal SQL text'},400):result(data);
  throw Error('Unexpected request');
 }}});client.auth.getUser=async()=>({data:{user:{id:actorId}},error:null});return {client,requests};
}
const status=(promise,code)=>assert.rejects(promise,error=>error.status===code&&!error.message.includes('private internal'));
test('team queries require exact tenant/date scope, bounded pages and complete export without a cursor',()=>{
 assert.deepEqual(parseTeamTimesheetQuery(new URLSearchParams({tenantId,startDate:query.startDate,endDate:query.endDate})),query);
 for(const extra of [{startDate:'2026-02-30'},{startDate:'0000-01-01'},{startDate:'2026-10-26'},{endDate:''},{agentId:'foreign'},{limit:'101'},{limit:'0'},{mode:'payroll'},{private:'true'},{mode:'export',cursor:'abc'},{mode:'export',limit:'50'}])assert.throws(()=>parseTeamTimesheetQuery(new URLSearchParams({tenantId,startDate:query.startDate,endDate:query.endDate,...extra})),error=>error.status===400);
 assert.throws(()=>parseTeamTimesheetQuery(new URLSearchParams({tenantId})),error=>error.status===400);
 assert.throws(()=>parseTeamTimesheetQuery(new URLSearchParams(`tenantId=${tenantId}&tenantId=${agentId}&startDate=2026-10-25&endDate=2026-10-25`)),error=>error.status===400);
});
test('one signed RPC reads full-scope summary independently of paging; cursor preserves bigint text and microseconds',async()=>{
 const f=fixture();const result=await readTeamTimesheets(f.client,query);
 assert.equal(result.summary.entryCount,1204);assert.equal(result.entries.length,1);assert.equal(result.datasetVersion,'9007199254740993');assert.deepEqual(decodeTeamTimesheetCursor(result.nextCursor),cursor);
 assert.equal(f.requests.filter(request=>request.table==='read_team_timesheets').length,1);
 assert.deepEqual(JSON.parse(f.requests.find(request=>request.table==='read_team_timesheets').body),{target_tenant:tenantId,start_date:query.startDate,end_date:query.endDate,target_agent:null,page_limit:50,after_entry:null,export_all:false});
 assert.equal(f.requests.filter(request=>request.table==='tenant_memberships').length,2);
 for(const request of f.requests.filter(request=>request.table!=='read_team_timesheets'))assert.equal(request.url.searchParams.get('tenant_id')??request.url.searchParams.get('id'),'eq.'+tenantId);
});
test('cursor rejects injected timestamps, excess/unsafe version digits and arbitrary scope fields',()=>{
 assert.equal(decodeTeamTimesheetCursor(),null);
 for(const value of [{...cursor,startedAt:cursor.startedAt+'),id.gt.0'},{...cursor,datasetVersion:9007199254740993},{...cursor,datasetVersion:'9223372036854775808'},{...cursor,payroll:true}])assert.throws(()=>decodeTeamTimesheetCursor(Buffer.from(JSON.stringify(value)).toString('base64url')),error=>error.status===400);
 for(const value of ['bad()', 'x'.repeat(1401),'not-json'])assert.throws(()=>decodeTeamTimesheetCursor(value),error=>error.status===400);
});
test('current role, foreign/revoked company and timezone changes prevent summaries and exports',async()=>{
 for(const options of [{role:'employee'},{role:'manager'},{denied:true}]){const f=fixture(options);await status(readTeamTimesheets(f.client,query),403);assert.equal(f.requests.some(request=>request.table==='read_team_timesheets'),false);}
 for(const options of [{revoke:true},{changedRole:'admin'},{changedZone:'UTC'}])await status(readTeamTimesheets(fixture(options).client,query),403);
 for(const [rpcCode,code] of [['42501',403],['40001',409],['54000',413],['22023',400],['XX000',503]])await status(readTeamTimesheets(fixture({rpcCode}).client,query),code);
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await status(readTeamTimesheets(f.client,query),401);assert.equal(f.requests.length,0);
});
test('malformed, cross-tenant, unfinished, negative, duplicate and mismatched responses fail closed',async()=>{
 for(const data of [null,{}, {...review,actorId:agentId},{...review,filters:{...review.filters,agentId}},{...review,entries:[{...entry,tenant_id:agentId}]},{...review,entries:[{...entry,ended_at:null}]},
  {...review,entries:[entry,entry]},{...review,summary:{...review.summary,entryCount:-1}},{...review,summary:{...review.summary,entryCount:Number.MAX_SAFE_INTEGER+1}},
  {...review,nextCursor:{...cursor,agentId}},{...review,timeZone:'Factory'}])await status(readTeamTimesheets(fixture({data}).client,query),503);
});
test('complete export is a single bounded RPC and refuses incomplete data before CSV generation',async()=>{
 const complete={...review,summary:{...review.summary,entryCount:1},agents:[],nextCursor:null};const f=fixture({data:complete});
 const data=await readTeamTimesheets(f.client,{...query,mode:'export'});assert.equal(JSON.parse(f.requests.find(request=>request.table==='read_team_timesheets').body).export_all,true);
 assert.equal(f.requests.filter(request=>request.table==='read_team_timesheets').length,1);assert.equal(teamTimesheetCSV(data).split('\r\n').length,3);
 for(const partial of [review,{...complete,summary:{...complete.summary,entryCount:2}}])await status(readTeamTimesheets(fixture({data:partial}).client,{...query,mode:'export'}),503);
 assert.throws(()=>teamTimesheetCSV({...data,nextCursor:'partial'}),error=>error.status===503);
});
test('CSV reuses directory protection for formulas/control prefixes, quotes and retained timestamp precision',async()=>{
 const complete={...review,summary:{...review.summary,entryCount:1},nextCursor:null,entries:[{...entry,agent_name:'\n=HYPERLINK("x")',job_name:'  ＝SUM(1,2)'}]};
 const data=await readTeamTimesheets(fixture({data:complete}).client,{...query,mode:'export'});const csv=teamTimesheetCSV(data);
 assert.ok(csv.startsWith('\uFEFF'));assert.ok(csv.includes('"\'\n=HYPERLINK(""x"")"'));assert.ok(csv.includes('"\'  ＝SUM(1,2)"'));assert.ok(csv.includes('.123456+00:00'));assert.ok(csv.includes('Europe/London'));
});

test('complete CSV streams every UTF-8 byte beyond buffered response limits, preserving BOM and split multibyte characters',async()=>{
 const entries=Array.from({length:10000},(_,i)=>({...entry,id:`10000000-0000-4000-8000-${String(i+1).padStart(12,'0')}`,agent_name:'😀'.repeat(100),job_name:'🧰'.repeat(100)}));
 const data={...review,entries,nextCursor:null,summary:{entryCount:10000,agentCount:1,elapsedSeconds:36000000,unpaidBreakSeconds:6000000,paidSeconds:30000000}};
 const expected=Buffer.from(teamTimesheetCSV(data),'utf8');assert.ok(expected.byteLength>4.5*1024*1024);
 const reader=teamTimesheetCSVStream(data).getReader(),parts=[];
 for(;;){const {value,done}=await reader.read();if(done)break;assert.ok(value.byteLength<=64*1024);parts.push(Buffer.from(value));}
 assert.ok(parts.length>1);assert.deepEqual(Buffer.concat(parts),expected);
 assert.throws(()=>teamTimesheetCSVStream({...data,nextCursor:'partial'}),error=>error.status===503);
});
