import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient } from '@supabase/supabase-js';
import { parseOverviewQuery, parseActivityQuery, companyDateBoundary, activityCursor, activityCursorFilter, readOverview, readActivity } from '../../lib/workforce-overview.ts';
const tenantId='10000000-0000-4000-8000-000000000001', userId='10000000-0000-4000-8000-000000000002', agentId='10000000-0000-4000-8000-000000000003';
const company={id:tenantId,name:'Synthetic Company',time_zone:'Europe/London',status:'active'};
const at='2026-10-25T01:30:00.123456+00:00';
const events=['9007199254740995','9007199254740994','9007199254740993'].map(id=>({id,agent_id:agentId,actor_user_id:userId,actor_name:'Synthetic owner',action:'updated',revision:2,occurred_at:at,private_payload:'never expose'}));
function fixture({role='owner', denied=false, failCount=false, nullCount=false, failActivity=false, revoke=false}={}) {
 const requests=[];let checked=0;
 const client=createClient('http://127.0.0.1:54821','synthetic-publishable-key',{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:async(raw,init)=>{
  const url=new URL(String(raw)), table=url.pathname.split('/').at(-1), params=url.searchParams;
  requests.push({table,params,method:init.method,headers:new Headers(init.headers)});
  const result=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json',...headers}});
  if(init.method==='HEAD') {
   if(failCount)return result({message:'read failed',code:'XX000'},503);
   const counts=table==='agents'?(params.get('status')==='eq.archived'?17:params.get('user_id')==='is.null'?300:params.get('user_id')==='not.is.null'?2200:2500):{owner:1,admin:2,manager:3,employee:2494}[params.get('role')?.slice(3)];
   return new Response(null,{status:200,headers:nullCount?{}:{'Content-Range':`*/${counts}`}});
  }
  if(table==='tenants')return result(denied?[]:[company]);
  if(table==='tenant_memberships'){checked++;return result(denied||revoke&&checked>1?[]:[{role}]);}
  if(table==='agent_audit')return failActivity?result({message:'failed',code:'XX000'},503):result(events);
  if(table==='agents')return result([{id:agentId,first_name:'Synthetic',last_name:'agent',phone:'private'}]);
  throw new Error('Unexpected fixture request '+url);
 }}});
 client.auth.getUser=async()=>({data:{user:{id:userId}},error:null});
 return {client,requests};
}
const rejectsStatus=(promise,status)=>assert.rejects(promise,error=>error.status===status);
test('overview uses eight exact scoped server counts above directory limits and bounded safe activity',async()=>{
 const {client,requests}=fixture();const data=await readOverview(client,tenantId);
 assert.deepEqual(data.agents,{active:2500,archived:17,linked:2200,unlinked:300});
 assert.deepEqual(data.memberships,{owner:1,admin:2,manager:3,employee:2494});assert.equal(data.role,'owner');assert.equal(data.canViewActivity,true);
 assert.equal(data.recentActivity[0].id,'9007199254740995');assert.equal(data.recentActivity[0].agent_name,'Synthetic agent');assert.equal('private_payload' in data.recentActivity[0],false);
 const counts=requests.filter(request=>request.method==='HEAD');assert.equal(counts.length,8);
 for(const request of counts){assert.equal(request.headers.get('Prefer'),'count=exact');assert.equal(request.params.get('tenant_id'),'eq.'+tenantId);assert.equal(request.params.get('limit'),null);}
 const audit=requests.find(request=>request.table==='agent_audit');assert.equal(audit.params.get('limit'),'7');assert.equal(audit.params.get('select'),'id::text,agent_id,actor_user_id,actor_name,action,revision,occurred_at');
 assert.equal(requests.filter(request=>request.table==='tenant_memberships'&&request.method!=='HEAD').length,2);
});
test('manager counts remain available without audit; employee and foreign/revoked access never return summaries',async()=>{
 const manager=fixture({role:'manager'});const data=await readOverview(manager.client,tenantId);assert.equal(data.canViewActivity,false);assert.deepEqual(data.recentActivity,[]);assert.equal(manager.requests.some(request=>request.table==='agent_audit'),false);
 for(const options of [{role:'employee'},{denied:true}]){const f=fixture(options);await rejectsStatus(readOverview(f.client,tenantId),403);assert.equal(f.requests.some(request=>request.method==='HEAD'),false);}
 await rejectsStatus(readOverview(fixture({revoke:true}).client,tenantId),403);
 await rejectsStatus(readActivity(fixture({revoke:true}).client,tenantId,{limit:2}),403);
 const managerActivity=fixture({role:'manager'});await rejectsStatus(readActivity(managerActivity.client,tenantId,{limit:2}),403);assert.equal(managerActivity.requests.some(request=>request.table==='agent_audit'),false);
});
test('failed or missing counts and failed activity reads are errors, never apparent zero results',async()=>{
 for(const options of [{failCount:true},{nullCount:true},{failActivity:true}])await rejectsStatus(readOverview(fixture(options).client,tenantId),503);
 await rejectsStatus(readActivity(fixture({failActivity:true}).client,tenantId,{limit:2}),503);
 const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejectsStatus(readOverview(f.client,tenantId),401);assert.equal(f.requests.length,0);
});
test('company calendar boundaries include DST days, fractional offsets and a skipped date without UTC fallback',()=>{
 assert.equal(companyDateBoundary('2026-10-25','Europe/London'),'2026-10-24T23:00:00.000Z');
 assert.equal(companyDateBoundary('2026-10-25','Europe/London',true),'2026-10-26T00:00:00.000Z');
 assert.equal(companyDateBoundary('2026-03-08','America/New_York'),'2026-03-08T05:00:00.000Z');
 assert.equal(companyDateBoundary('2026-03-08','America/New_York',true),'2026-03-09T04:00:00.000Z');
 assert.equal(companyDateBoundary('2026-10-03','Asia/Kathmandu'),'2026-10-02T18:15:00.000Z');
 assert.equal(companyDateBoundary('2011-12-30','Pacific/Apia'),companyDateBoundary('2011-12-30','Pacific/Apia',true));
 assert.throws(()=>companyDateBoundary('2026-10-03','Invalid/Zone'),error=>error.status===503);
});
test('activity validates filter/cursor grammar, binds scope and preserves bigint and microsecond ordering',async()=>{
 const filters={action:'updated',startDate:'2026-10-25',endDate:'2026-10-25',limit:2};
 const f=fixture();const data=await readActivity(f.client,tenantId,filters);assert.equal(data.events.length,2);assert.ok(data.nextCursor);
 const filter=activityCursorFilter(tenantId,'Europe/London',{...filters,cursor:data.nextCursor});
 assert.equal(filter,`occurred_at.lt.${at},and(occurred_at.eq.${at},id.lt.9007199254740994)`);
 const next=fixture();await readActivity(next.client,tenantId,{...filters,cursor:data.nextCursor});const query=next.requests.find(request=>request.table==='agent_audit').params;
 assert.equal(query.get('order'),'occurred_at.desc,id.desc');assert.equal(query.get('limit'),'3');assert.equal(query.get('action'),'eq.updated');assert.equal(query.get('gte'),null);assert.equal(query.getAll('occurred_at')[0],'gte.2026-10-24T23:00:00.000Z');assert.equal(query.getAll('occurred_at')[1],'lt.2026-10-26T00:00:00.000Z');assert.equal(query.get('or'),'('+filter+')');
 for(const changed of [{...filters,action:'created'},{...filters,endDate:'2026-10-26'}])assert.throws(()=>activityCursorFilter(tenantId,'Europe/London',{...changed,cursor:data.nextCursor}),error=>error.status===400);
 assert.throws(()=>activityCursorFilter(userId,'Europe/London',{...filters,cursor:data.nextCursor}),error=>error.status===400);
 const decoded=JSON.parse(Buffer.from(data.nextCursor,'base64url'));decoded.at=at+'),id.gt.0';assert.throws(()=>activityCursorFilter(tenantId,'Europe/London',{...filters,cursor:Buffer.from(JSON.stringify(decoded)).toString('base64url')}),error=>error.status===400);
 assert.throws(()=>activityCursor(tenantId,'Europe/London',filters,{id:'9223372036854775808',occurred_at:at}));
});
test('API query parsing rejects duplicate companies, unknown fields, invalid dates/actions/limits and reversed ranges',()=>{
 assert.equal(parseOverviewQuery(new URLSearchParams({tenantId})),tenantId);assert.equal(parseActivityQuery(new URLSearchParams({tenantId})).filters.limit,50);
 for(const query of [`tenantId=${tenantId}&tenantId=${userId}`,`tenantId=${tenantId}&private=true`])assert.throws(()=>parseOverviewQuery(new URLSearchParams(query)),error=>error.status===400);
 for(const extra of [{action:'login'},{startDate:'2026-02-30'},{startDate:'0000-01-01'},{limit:'101'},{limit:'0'},{limit:'5,or(id.gt.0)'},{cursor:'bad()'},{startDate:'2026-10-04',endDate:'2026-10-03'}])assert.throws(()=>parseActivityQuery(new URLSearchParams({tenantId,...extra})),error=>error.status===400);
});
