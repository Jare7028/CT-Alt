import test from 'node:test';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
registerHooks({resolve(s,c,next){return c.parentURL?.endsWith('/lib/updates-export.ts')&&s==='./csv'?next(new URL('./csv.ts',c.parentURL).href,c):next(s,c);}});
const{parseUpdatesExportQuery,readUpdatesExport,updatesExportCSV,UPDATES_EXPORT_MAX_BYTES}=await import('../../lib/updates-export.ts');
const tenantId='88000000-0000-4000-8000-000000000001',postId='89000000-0000-4000-8000-000000000001',actorId='00000000-0000-4000-8000-000000000901',other='00000000-0000-4000-8000-000000000902';
const recipients=Array.from({length:500},(_,i)=>({actorId:`00000000-0000-4000-8001-${String(i+1).padStart(12,'0')}`,name:`Synthetic ${i+1}`,viewedAt:i<300?'2026-10-04T00:10:00.123456Z':null,confirmedAt:i<200?'2026-10-04T00:10:01.654321Z':null}));
const result={tenantId,actorId,role:'owner',postId,postStatus:'published',postRevision:2,contentRevision:1,requireConfirmation:true,status:'all',counts:{total:500,viewed:300,confirmed:200},matchedCount:500,recipients};
const current={actorId,role:'owner',postStatus:'published',postRevision:2,contentRevision:1,isRecipient:false,posts:[]};
const query={tenantId,postId,status:'all'};
function fixture(data=result,access=current,error=null,accessError=null){const calls=[];return{calls,client:{auth:{getUser:async()=>({data:{user:{id:actorId}},error:null})},rpc:async(name,args)=>{calls.push({name,args});return name==='read_updates_access'?{data:access,error:accessError}:{data,error};}}};}
const rejects=(p,status=503)=>assert.rejects(p,e=>e.status===status);
test('Export accepts only singular tenant/status + dynamic UUID, rejecting duplicate/cursor/limit injections',()=>{
 assert.deepEqual(parseUpdatesExportQuery(new URLSearchParams({tenantId}),postId),query);
 for(const p of [{tenantId,limit:'50'},{tenantId,cursor:'anything'},{tenantId,status:'bad'},{tenantId,view:'manage'},{tenantId:'bad'},{tenantId,status:'viewed) OR true'}])assert.throws(()=>parseUpdatesExportQuery(new URLSearchParams(p),postId),e=>e.status===400);
 assert.throws(()=>parseUpdatesExportQuery(new URLSearchParams(`tenantId=${tenantId}&status=all&status=all`),postId),e=>e.status===400);assert.throws(()=>parseUpdatesExportQuery(new URLSearchParams({tenantId}),'bad'),e=>e.status===400);
});
test('One coherent complete500 snapshot + current signed lifecycle/access recheck, no mark/mutation actions',async()=>{
 const f=fixture(),d=await readUpdatesExport(f.client,query);assert.equal(d.recipients.length,500);assert.equal(d.counts.total,500);assert.deepEqual(f.calls,[{name:'read_update_recipients_export',args:{target_tenant:tenantId,target_post:postId,status_filter:'all'}},{name:'read_updates_access',args:{target_tenant:tenantId,target_post:postId,target_posts:[]}}]);
 const csv=updatesExportCSV(d);assert.equal(csv.split('\r\n').length,502);assert.ok(csv.startsWith('\uFEFF"User name","User ID","Viewed","Viewed at (UTC)","Confirmed","Confirmed at (UTC)"\r\n'));assert.ok(csv.includes('2026-10-04T00:10:00.123456Z'));
});
test('All selected status scopes are complete independent of displayed50row page; empty legitimate scope is headers',async()=>{
 const predicates={all:()=>true,viewed:r=>r.viewedAt!==null,unviewed:r=>r.viewedAt===null,confirmed:r=>r.confirmedAt!==null,unconfirmed:r=>r.confirmedAt===null};
 for(const[status,filter]of Object.entries(predicates)){const rows=recipients.filter(filter),data={...result,status,matchedCount:rows.length,recipients:rows};assert.equal((await readUpdatesExport(fixture(data).client,{...query,status})).recipients.length,rows.length);}
 const empty={...result,status:'confirmed',counts:{total:500,viewed:0,confirmed:0},matchedCount:0,recipients:[]};const csv=updatesExportCSV(await readUpdatesExport(fixture(empty).client,{...query,status:'confirmed'}));assert.equal(csv.split('\r\n').length,2);
});
test('Partial, wrong identity/filter/role, malformed fields/counts, duplicate/order and invalid timestamps refuse CSV',async()=>{
 const bad=[null,{},...[{tenantId:other},{actorId:other},{postId:other},{role:'employee'},{status:'viewed'},{matchedCount:499},{counts:{}},{counts:{total:500,viewed:300}},{counts:{total:500,viewed:1,confirmed:200}},{counts:{total:500.5,viewed:300,confirmed:200}},{counts:{total:Number.MAX_SAFE_INTEGER+1,viewed:300,confirmed:200}},{recipients:recipients.slice(0,50)},{recipients:[...recipients.slice(1),recipients[0]]},{recipients:[recipients[0],recipients[0],...recipients.slice(2)]},{recipients:[{...recipients[0],viewedAt:null},...recipients.slice(1)]},{recipients:[{...recipients[0],viewedAt:'2026-10-04T00:10:00.123456+03:00'},...recipients.slice(1)]},{recipients:[{...recipients[0],name:'😀'.repeat(101)},...recipients.slice(1)]},{recipients:[{...recipients[0],commentBody:'private'},...recipients.slice(1)]}].map(p=>({...result,...p}))];
 for(const data of bad)await assert.rejects(readUpdatesExport(fixture(data).client,query),e=>[503,413].includes(e.status));
 assert.throws(()=>updatesExportCSV({...result,recipients:recipients.slice(0,50)}),e=>e.status===503);
});
test('Current role/actor/company denial and snapshot lifecycle/content change prevent download; failures redacted',async()=>{
 for(const patch of [{role:'employee'},{role:'admin'},{actorId:other},{postStatus:null}])await rejects(readUpdatesExport(fixture(result,{...current,...patch}).client,query),403);
 for(const patch of [{postStatus:'archived'},{postRevision:3},{contentRevision:0}])await rejects(readUpdatesExport(fixture(result,{...current,...patch}).client,query),409);
 for(const[code,status]of [['42501',403],['22023',400],['54000',413],['XX000',503]])await assert.rejects(readUpdatesExport(fixture(null,null,{code,message:'private DB diagnostic'}).client,query),e=>e.status===status&&!e.message.includes('private DB'));
 await rejects(readUpdatesExport(fixture(result,null,null,{code:'XX000'}).client,query));const f=fixture();f.client.auth.getUser=async()=>({data:{user:null},error:null});await rejects(readUpdatesExport(f.client,query),401);assert.equal(f.calls.length,0);
});
test('CSV escapes quotes commas multiline formula/control prefixes and preserves UTF8/preciseUTC timestamps',()=>{
 const names=['=CMD()',' +SUM(A1)','＠formula','\ncontrol','Line1\r\nLine2,"quoted"','Normal😀'];const rows=recipients.slice(0,6).map((r,i)=>({...r,name:names[i]}));const csv=updatesExportCSV({...result,counts:{total:6,viewed:6,confirmed:6},matchedCount:6,recipients:rows});for(const risky of names.slice(0,4))assert.ok(csv.includes('"\''+risky+'"'));assert.ok(csv.includes('"Line1\r\nLine2,""quoted"""'));assert.ok(csv.includes('Normal😀'));assert.ok(csv.includes('2026-10-04T00:10:01.654321Z'));
});
test('Disabled confirmation says Not required, while unconfirmed scope preserves null timestamp semantics',async()=>{
 const rows=recipients.map(r=>({...r,confirmedAt:null})),d={...result,requireConfirmation:false,counts:{total:500,viewed:300,confirmed:0},status:'unconfirmed',recipients:rows};const csv=updatesExportCSV(await readUpdatesExport(fixture(d).client,{...query,status:'unconfirmed'}));assert.ok(csv.includes('"Not required",""'));assert.equal((csv.match(/Not required/g)||[]).length,500);
 await rejects(readUpdatesExport(fixture({...result,requireConfirmation:false}).client,query));
});
test('Full500×100nonBMP names plus both precise timestamps succeeds below1MiB with no truncation',async()=>{
 const rows=recipients.map(r=>({...r,name:'😀'.repeat(100),viewedAt:'2026-10-04T00:10:00.123456Z',confirmedAt:'2026-10-04T00:10:01.654321Z'})),d={...result,counts:{total:500,viewed:500,confirmed:500},recipients:rows};const csv=updatesExportCSV(await readUpdatesExport(fixture(d).client,query)),bytes=new TextEncoder().encode(csv).length;assert.ok(bytes>256000);assert.ok(bytes<=UPDATES_EXPORT_MAX_BYTES);assert.equal((csv.match(/😀/gu)||[]).length,50000);assert.equal(csv.split('\r\n').length,502);
});
