import {test,expect} from '@playwright/test';
import {readFileSync} from 'node:fs';
import {spawn,spawnSync} from 'node:child_process';
import {randomUUID,createHash} from 'node:crypto';
const fixture=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
const origin='http://127.0.0.1:5180',db='supabase_db_ct-alt-independent',uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
if(fixture.url!=='http://127.0.0.1:54821'||!/^[0-9a-f]{8}$/.test(fixture.fixtureLabel))throw Error('Owned loopback fixture required');
test.describe.configure({mode:'serial'});test.setTimeout(120000);
let baseId,parentId,nodeId,currentVersion,metadata,employee,legacy,functions,legacyTables;
const bulk='69000000-0000-4000-8000-',retainedId=bulk+'000000002001',replacement=bulk+'000000002002';
const bytes=Buffer.from('=SUM(1,2),東京,😀\r\n  Original synthetic bytes  \r\n','utf8');
const hash=value=>createHash('sha256').update(value).digest('hex');
function sql(text){const label=spawnSync('docker',['inspect',db,'--format','{{index .Config.Labels "ct-alt.test"}}'],{encoding:'utf8'});if(label.status!==0||label.stdout.trim()!==fixture.fixtureLabel)throw Error('Fixture database identity mismatch');const r=spawnSync('docker',['exec','-i',db,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{input:text,encoding:'utf8',timeout:30000});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();}
const quote=value=>"'"+value.replaceAll("'","''")+"'";
function snapshot(tables=legacyTables){return sql(`select jsonb_object_agg(name,hash) from (${tables.map(table=>`select ${quote(table)} as name,(select md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text),'[]')::text) from ${table} t) as hash`).join(' union all ')}) retained;`);}
const functionSnapshot=`select md5(jsonb_agg(jsonb_build_object('id',p.oid,'definition',pg_get_functiondef(p.oid),'owner',p.proowner,'acl',p.proacl,'config',p.proconfig) order by p.oid)::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workforce_private','chat_private') and p.prokind='f';`;

async function login(page,account='owner'){await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(fixture.accounts[account].email);await page.getByLabel('Password',{exact:true}).fill(fixture.accounts[account].password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page).toHaveURL(/\/agents/);}
async function write(request,change){const response=await request.post('/api/knowledge-base',{headers:{Origin:origin},data:{tenantId:fixture.tenantA,operationId:randomUUID(),change}});expect(response.status()).toBe(200);return(await response.json()).saved;}
async function base(request){const response=await request.get(`/api/knowledge-base/${baseId}?tenantId=${fixture.tenantA}&view=manage`);expect(response.status()).toBe(200);return response.json();}
async function detail(request,view='manage'){const r=await request.get(`/api/knowledge-base/${baseId}/nodes/${nodeId}?tenantId=${fixture.tenantA}&view=${view}`);expect(r.status()).toBe(200);return r.json();}
function upload(request,value=metadata,content=bytes,mime='text/csv'){return request.post(`/api/knowledge-base/${value.baseId}/files`,{headers:{Origin:origin},multipart:{metadata:JSON.stringify(value),file:{name:value.filename,mimeType:mime,buffer:content}}});}
function download(request,versionId=currentVersion,tenantId=fixture.tenantA){return request.get(`/api/knowledge-base/${baseId}/nodes/${nodeId}/download?${new URLSearchParams({tenantId,versionId})}`);}
async function recover(request,operationId){return request.post('/api/knowledge-base/files/reconcile',{headers:{Origin:origin},data:{tenantId:fixture.tenantA,operationId}});}
function privateResponse(response){expect(response.headers()['cache-control']).toContain('no-store');}

test.beforeAll(()=>{
 employee=sql(`select id from public.agents where tenant_id='${fixture.tenantA}' and user_id='${fixture.accounts.employee.id}';`);expect(uuid.test(employee)).toBe(true);
 sql(`insert into auth.users(id,email,email_confirmed_at,role,aud,is_anonymous) select ('${bulk}'||lpad(i::text,12,'0'))::uuid,'knowledge-assignee-'||i||'@example.test',now(),'authenticated','authenticated',false from generate_series(1,1005)i;
 insert into public.tenant_memberships(tenant_id,user_id,display_name,role) select '${fixture.tenantA}',('${bulk}'||lpad(i::text,12,'0'))::uuid,'Synthetic KB account '||lpad(i::text,4,'0'),'employee' from generate_series(1,1005)i;
 insert into public.agents(id,tenant_id,first_name,last_name,phone,created_by) values('${replacement}','${fixture.tenantA}','Synthetic','replacement','+447700902101','${fixture.accounts.owner.id}');
   insert into public.rota_schedules(id,tenant_id,name,time_zone) values('${retainedId}','${fixture.tenantA}','Retained synthetic diary','Europe/London');
 insert into public.rota_admins values('${fixture.tenantA}','${retainedId}','${fixture.accounts.owner.id}');insert into public.rota_agents values('${fixture.tenantA}','${retainedId}','${employee}');
 insert into public.rota_jobs(id,tenant_id,schedule_id,name,color) values('${retainedId}','${fixture.tenantA}','${retainedId}','Retained diary job','#2998ff');
 insert into public.rota_shifts(id,tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,title,status,published_at) values('${retainedId}','${fixture.tenantA}','${retainedId}','${employee}','${retainedId}','2026-10-03T08:00:00Z','2026-10-03T09:00:00Z','Retained diary shift','published','2026-10-02T12:00:00Z');
 insert into public.time_clock_jobs(id,tenant_id,name) values('${retainedId}','${fixture.tenantA}','Retained clock job');insert into public.time_clock_entries(id,tenant_id,agent_id,job_id,agent_name,job_name,started_at,ended_at) values('${retainedId}','${fixture.tenantA}','${employee}','${retainedId}','Retained employee','Retained clock job','2026-10-03T08:00:00Z','2026-10-03T09:00:00Z');
 insert into public.chat_conversations(id,tenant_id,kind,name,last_sequence) values('${retainedId}','${fixture.tenantA}','group','Retained chat',1);insert into public.chat_members(tenant_id,conversation_id,user_id) values('${fixture.tenantA}','${retainedId}','${fixture.accounts.owner.id}'),('${fixture.tenantA}','${retainedId}','${fixture.accounts.employee.id}');insert into public.chat_messages(tenant_id,conversation_id,sequence,sender_id,sender_name,client_id,body) values('${fixture.tenantA}','${retainedId}',1,'${fixture.accounts.employee.id}','Retained employee',gen_random_uuid(),'Retained synthetic message');



 `);
 sql(`insert into public.time_off_types(id,tenant_id,name,description,paid,created_by) values('${retainedId}','${fixture.tenantA}','Retained leave','Retained leave type',true,'${fixture.accounts.owner.id}');insert into public.time_off_requests(id,tenant_id,agent_id,agent_name,type_id,type_name,type_description,type_paid,start_date,end_date,note,requested_by) values('${retainedId}','${fixture.tenantA}','${employee}','Synthetic employee','${retainedId}','Retained leave','Retained leave type',true,'2026-10-03','2026-10-04','Retained leave request','${fixture.accounts.employee.id}');`);
 sql(`insert into public.updates_posts(id,tenant_id,title,body,status,revision,content_revision,allow_comments,allow_reactions,require_confirmation,created_by,created_name,published_at) values('${retainedId}','${fixture.tenantA}','Retained synthetic bulletin','Retained Updates history','published',2,1,true,true,true,'${fixture.accounts.owner.id}','Synthetic owner','2026-10-03T10:00:00.123456Z');insert into public.updates_recipients(tenant_id,post_id,actor_id,name,viewed_at,confirmed_at) values('${fixture.tenantA}','${retainedId}','${fixture.accounts.employee.id}','Synthetic employee','2026-10-03T10:01:00.123456Z','2026-10-03T10:02:00.654321Z');insert into public.updates_comments(tenant_id,post_id,actor_id,author_name,body) values('${fixture.tenantA}','${retainedId}','${fixture.accounts.employee.id}','Synthetic employee','Retained synthetic comment');
 insert into public.smart_group_segments(id,tenant_id,name,description) values('${retainedId}','${fixture.tenantA}','Retained organizational segment','Synthetic retained definition');insert into public.smart_groups(id,tenant_id,segment_id,name,description,rules) values('${retainedId}','${fixture.tenantA}','${retainedId}','Retained organizational group','Synthetic retained rule','[{"field":"team","values":["North"]}]');`);
 legacyTables=sql(`select schemaname||'.'||tablename from pg_tables where schemaname in('public','workforce_private','chat_private') and tablename not like 'knowledge_%' order by schemaname,tablename;`).split('\n');expect(legacyTables.every(table=>/^(public|workforce_private|chat_private)\.[a-z_]+$/.test(table))).toBe(true);legacy=snapshot();functions=sql(functionSnapshot);
});
test.afterAll(()=>{expect(snapshot()).toBe(legacy);expect(sql(functionSnapshot)).toBe(functions);});
// Actual HTTP provider bytes and stored immutable UUID version, never a mocked Storage table.
test('genuine provider accepts one signed upload and exact UTF8 CSV bytes; download never records views',async({page})=>{
 await login(page);const request=page.request;
 baseId=(await write(request,{action:'create_base',name:'Synthetic files reference',description:'Real provider only',audienceIds:[fixture.accounts.employee.id,fixture.accounts.manager.id]})).baseId;
 parentId=(await write(request,{action:'create_node',baseId,revision:(await base(request)).base.revision,parentId:null,kind:'folder',name:'Files',description:''})).nodeId;
 metadata={tenantId:fixture.tenantA,operationId:randomUUID(),baseId,mode:'create',expectedBaseRevision:(await base(request)).base.revision,parentId,name:'Synthetic original CSV',description:'Original bytes retained',filename:'東京 😀.csv'};
 const response=await upload(request);const result=await response.json();const diagnostic=typeof result.error==='string'?result.error.slice(0,300).replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[redacted token]'):'No API error message';expect(response.status(),diagnostic).toBe(200);privateResponse(response);const ack=result.saved;
 expect(ack).toMatchObject({actorId:fixture.accounts.owner.id,tenantId:fixture.tenantA,operationId:metadata.operationId,action:'save_file',baseId});nodeId=ack.nodeId;currentVersion=ack.versionId;
 const data=await detail(request);expect(data.node.kind).toBe('file');expect(data.node.currentFile).toMatchObject({versionId:currentVersion,filename:metadata.filename,bytes:bytes.length,sha256:hash(bytes),mediaType:'text/csv'});
 expect(sql('select count(*) from storage.migrations')).toBe('73');
 const count=sql(`select count(*) from public.knowledge_events where base_id='${baseId}'`);
 const binary=await download(request);expect(binary.status()).toBe(200);privateResponse(binary);expect(binary.headers()['content-length']).toBe(String(bytes.length));expect(binary.headers()['x-content-type-options']).toBe('nosniff');expect(binary.headers()['content-disposition']).toContain('attachment');
 for(const [key,value]of Object.entries({'x-ct-alt-actor-id':fixture.accounts.owner.id,'x-ct-alt-company-id':fixture.tenantA,'x-ct-alt-knowledge-base-id':baseId,'x-ct-alt-knowledge-node-id':nodeId,'x-ct-alt-knowledge-file-version-id':currentVersion}))expect(binary.headers()[key]).toBe(value);
 expect(await binary.body()).toEqual(bytes);expect(sql(`select count(*) from public.knowledge_events where base_id='${baseId}'`)).toBe(count);
 const state=await(await recover(request,metadata.operationId)).json();expect(state.status).toBe('finalized');expect(state.saved).toEqual(ack);expect(JSON.stringify(state)).not.toMatch(/provider|proof|sha256|filename|path|key_bytes/);
});

test('exact operation replay sends no second provider upload and invalid multipart consumes no allocation',async({page})=>{
 await login(page);const request=page.request;const before=sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota');
 expect((await request.post(`/api/knowledge-base/${baseId}/files`,{headers:{Origin:'https://foreign.invalid'},multipart:{metadata:JSON.stringify(metadata),file:{name:metadata.filename,mimeType:'text/csv',buffer:bytes}}})).status()).toBe(403);
 const invalidMetadata=await upload(request,{...metadata,operationId:randomUUID(),callerPath:'forbidden'});expect(invalidMetadata.status()).toBe(400);
 const retry=await upload(request);expect(retry.status()).toBe(200);expect((await retry.json()).saved.versionId).toBe(currentVersion);expect(sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota')).toBe(before);
 expect((await upload(request,{...metadata,name:'Different same UUID'})).status()).toBe(400);expect((await detail(request)).node.currentFile.versionId).toBe(currentVersion);expect(sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota')).toBe(before);
 for(const [content,mime,filename,status]of [[Buffer.alloc(0),'text/csv','empty.csv',413],[Buffer.from('<svg/>'),'image/svg+xml','bad.svg',422],[Buffer.from('a\0b'),'text/plain','nul.txt',422],[Buffer.alloc(2097153,97),'text/plain','large.txt',413]]){
  const value={...metadata,operationId:randomUUID(),expectedBaseRevision:(await base(request)).base.revision,filename};const response=await upload(request,value,content,mime);expect(response.status()).toBe(status);privateResponse(response);
 }
 expect(sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota')).toBe(before);
});

test('draft and fixed audience authorization uses current signed identity including old cookies',async({page})=>{
 await login(page);let revision=(await base(page.request)).base.revision;await write(page.request,{action:'publish_base',baseId,revision});
 for(const account of ['admin','manager','employee','foreign']){const context=await page.context().browser().newContext({baseURL:origin});const other=await context.newPage();await login(other,account);const allowed=account!=='foreign';const response=await download(other.request);expect(response.status()).toBe(allowed?200:403);if(allowed)expect(await response.body()).toEqual(bytes);
  if(account==='employee'){sql(`update public.tenant_memberships set status='suspended'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.employee.id}'`);try{expect((await download(other.request)).status()).toBe(403);expect((await recover(other.request,metadata.operationId)).status()).toBe(403);}finally{sql(`update public.tenant_memberships set status='active'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.employee.id}'`);}}
  expect((await upload(other.request,{...metadata,operationId:randomUUID()})).status()).toBe(account==='admin'?409:403);await context.close();
 }
 expect((await download(page.request,currentVersion,fixture.tenantB)).status()).toBe(403);
});

async function signedRpc(account,name,data){const tokenResponse=await fetch(fixture.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.key,'Content-Type':'application/json'},body:JSON.stringify({email:fixture.accounts[account].email,password:fixture.accounts[account].password})});expect(tokenResponse.status).toBe(200);const {access_token}=await tokenResponse.json();return fetch(fixture.url+'/rest/v1/rpc/'+name,{method:'POST',headers:{apikey:fixture.key,Authorization:'Bearer '+access_token,'Content-Type':'application/json'},body:JSON.stringify(data)});}

test('signed direct RPC cannot forge provider success or finalization; uncertain allocations remain charged after close',async({page})=>{
 await login(page);const operationId=randomUUID(),intentMetadata={...metadata,operationId,name:'Synthetic non-uploaded attempt',expectedBaseRevision:(await base(page.request)).base.revision};
 const reserve=await signedRpc('owner','reserve_knowledge_file',{target_tenant:fixture.tenantA,operation_id:operationId,intent:{metadata:intentMetadata,bytes:bytes.length,sha256:hash(bytes),mediaType:'text/csv'}});expect(reserve.status).toBe(200);
 const attempt=await(await recover(page.request,operationId)).json();expect(attempt.status).toBe('upload_attempted');expect(attempt.capabilities.canFinalize).toBe(false);
 const allocation=sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota');
 for(const action of ['provider_success','finalize']){const forged=await signedRpc('owner','change_knowledge_file',{target_tenant:fixture.tenantA,operation_id:operationId,action,expected_revision:attempt.attemptRevision,key_id:'fixture-v1',proof:'0'.repeat(64),expires_ms:Date.now()+30000});expect([400,403]).toContain(forged.status);}
 for(let i=0;i<2;i++)expect((await(await recover(page.request,operationId)).json()).status).toBe('upload_attempted');
 expect((await detail(page.request)).node.currentFile.versionId).toBe(currentVersion);
 const closed=await page.request.post('/api/knowledge-base/files/close',{headers:{Origin:origin},data:{tenantId:fixture.tenantA,operationId,expectedAttemptRevision:attempt.attemptRevision}});expect(closed.status()).toBe(200);expect((await closed.json()).status).toBe('closed');
 expect(sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota')).toBe(allocation);
 expect((await upload(page.request,intentMetadata)).status()).not.toBe(200);
 expect(sql('select allocated_bytes||\':\'||allocated_attempts from workforce_private.knowledge_file_quota')).toBe(allocation);
});

test('replacement switches only the exact current version and retains prior allocation and immutable original bytes',async({page})=>{
 await login(page);const oldVersion=currentVersion,oldDetail=await detail(page.request),oldAllocation=JSON.parse(sql('select json_build_object(\'bytes\',allocated_bytes,\'attempts\',allocated_attempts)from workforce_private.knowledge_file_quota'));
 const replacementBytes=Buffer.from('Synthetic replacement\n東京 😀\n');const replacementMetadata={tenantId:fixture.tenantA,operationId:randomUUID(),baseId,mode:'replace',expectedBaseRevision:(await base(page.request)).base.revision,nodeId,expectedNodeRevision:oldDetail.node.revision,name:'Synthetic updated document',description:'Only actual verified bytes',filename:'replacement.txt'};
 const response=await upload(page.request,replacementMetadata,replacementBytes,'text/plain');expect(response.status()).toBe(200);const ack=(await response.json()).saved;expect(ack.nodeId).toBe(nodeId);expect(ack.versionId).not.toBe(oldVersion);currentVersion=ack.versionId;
 expect((await download(page.request,oldVersion)).status()).toBe(409);expect(await(await download(page.request)).body()).toEqual(replacementBytes);
 const next=await detail(page.request);expect(next.node.currentFile).toMatchObject({versionId:currentVersion,sha256:hash(replacementBytes),bytes:replacementBytes.length});
 const allocated=JSON.parse(sql('select json_build_object(\'bytes\',allocated_bytes,\'attempts\',allocated_attempts)from workforce_private.knowledge_file_quota'));expect(allocated.bytes).toBe(oldAllocation.bytes+replacementBytes.length);expect(allocated.attempts).toBe(oldAllocation.attempts+1);
 expect(sql(`select count(*) from workforce_private.knowledge_file_versions where node_id='${nodeId}'`)).toBe('2');
 expect(sql(`select count(*) from storage.objects o join workforce_private.knowledge_file_attempts a on a.accepted_id=o.id where a.node_id='${nodeId}'and a.state='finalized'`)).toBe('2');
});

async function openFile(page){await page.getByRole('button',{name:'Open base Synthetic files reference',exact:true}).click();await page.getByRole('button',{name:'Open folder Files',exact:true}).click();const leaf=page.waitForResponse(r=>r.request().method()==='GET'&&r.url().includes(`/nodes/${nodeId}?`));await page.getByRole('button',{name:'Open resource Synthetic updated document',exact:true}).click();const response=await leaf;expect(response.status()).toBe(200);const body=await response.json();expect(body.node.id).toBe(nodeId);expect(body.node.currentFile.versionId).toBe(currentVersion);await expect(page.getByRole('button',{name:'Download current file',exact:true})).toBeVisible();}

test('desktop explicit file view and genuine download; refreshed scope fences held binary bodies and current denial clears private controls',async({page})=>{
 await login(page,'employee');await page.goto(`/knowledge-base?company=${fixture.tenantA}`);await openFile(page);
 await expect.poll(()=>sql(`select count(*) from public.knowledge_events where base_id='${baseId}'and actor_id='${fixture.accounts.employee.id}'and node_id='${nodeId}'`)).toBe('1');
 await page.screenshot({path:'test-results/knowledge-base-files-live-desktop-review.png',fullPage:true});
 const eventCount=sql(`select count(*) from public.knowledge_events where base_id='${baseId}'`);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Download current file',exact:true}).click();const file=await downloaded;const stream=await file.createReadStream();const chunks=[];for await(const chunk of stream)chunks.push(chunk);expect(Buffer.concat(chunks)).toEqual(Buffer.from('Synthetic replacement\n東京 😀\n'));expect(sql(`select count(*) from public.knowledge_events where base_id='${baseId}'`)).toBe(eventCount);
 await page.evaluate(()=>{const original=window.fetch.bind(window);window.__kbBodyHeld=false;window.fetch=async(...args)=>{const response=await original(...args);if(String(args[0]).includes('/download?')){const blob=response.blob.bind(response);response.blob=async()=>{const data=await blob();window.__kbBodyHeld=true;await new Promise(resolve=>{window.__releaseKbBody=resolve;});window.__kbBodyReleased=true;return data;};}return response;};});
 const observed=[];page.on('download',download=>observed.push(download));await page.getByRole('button',{name:'Download current file',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__kbBodyHeld)).toBe(true);
 const refreshed=page.waitForResponse(r=>r.request().method()==='GET'&&new URL(r.url()).pathname===`/api/knowledge-base/${baseId}/nodes/${nodeId}`);await page.getByRole('button',{name:'Refresh Knowledge Base',exact:true}).click();const freshResponse=await refreshed;expect(freshResponse.status()).toBe(200);const fresh=await freshResponse.json();expect(fresh).toMatchObject({actorId:fixture.accounts.employee.id,tenantId:fixture.tenantA,baseId,node:{id:nodeId,currentFile:{versionId:currentVersion}}});await expect(page.getByRole('button',{name:'Download current file',exact:true})).toBeEnabled();await page.evaluate(()=>window.__releaseKbBody());await expect.poll(()=>page.evaluate(()=>window.__kbBodyReleased)).toBe(true);await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(observed).toHaveLength(0);expect(sql(`select count(*) from public.knowledge_events where base_id='${baseId}'`)).toBe(eventCount);
 await page.route(`**/api/knowledge-base/${baseId}/nodes/${nodeId}/download?**`,route=>route.fulfill({status:403,contentType:'application/json',body:JSON.stringify({error:'Current access revoked in isolated fixture'})}));await page.getByRole('button',{name:'Download current file',exact:true}).click();await expect(page.getByRole('region',{name:'Knowledge Base recovery',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Download current file',exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'Open base Synthetic files reference',exact:true})).toHaveCount(0);
});

test('genuine Storage signed operations deny upsert/sign/list exposure and old JWT after current management revocation',async({page})=>{
 await login(page);const tokenResponse=await fetch(fixture.url+'/auth/v1/token?grant_type=password',{method:'POST',headers:{apikey:fixture.key,'Content-Type':'application/json'},body:JSON.stringify({email:fixture.accounts.owner.email,password:fixture.accounts.owner.password})});expect(tokenResponse.status).toBe(200);const {access_token}=await tokenResponse.json();
 const actual=JSON.parse(sql(`select json_build_object('path',a.path,'version',a.accepted_version)from workforce_private.knowledge_file_attempts a join workforce_private.knowledge_file_versions v on v.attempt_id=a.id where v.id='${currentVersion}'`));
 const storage=(path,method='GET',body,headers={})=>fetch(fixture.url+'/storage/v1'+path,{method,headers:{apikey:fixture.key,Authorization:'Bearer '+access_token,...headers},body});
 const getPath='/object/authenticated/ct-alt-knowledge-base/'+actual.path+'?versionId='+actual.version;
 const original=await storage(getPath);expect(original.status).toBe(200);expect(Buffer.from(await original.arrayBuffer())).toEqual(Buffer.from('Synthetic replacement\n東京 😀\n'));
 const overwrite=await storage('/object/ct-alt-knowledge-base/'+actual.path,'POST','Forbidden replacement',{'Content-Type':'text/plain','x-upsert':'true'});expect([400,403,409]).toContain(overwrite.status);
 const sign=await storage('/object/sign/ct-alt-knowledge-base/'+actual.path,'POST',JSON.stringify({expiresIn:60}),{'Content-Type':'application/json'});expect([400,403]).toContain(sign.status);
 const list=await storage('/object/list/ct-alt-knowledge-base','POST',JSON.stringify({prefix:fixture.tenantA,limit:100}),{'Content-Type':'application/json'});expect(list.status).toBe(200);expect(await list.json()).toEqual([]);
 sql(`update public.tenant_memberships set role='manager'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.owner.id}'`);
 try{const revoked=await storage(getPath);expect([400,403]).toContain(revoked.status);expect((await recover(page.request,metadata.operationId)).status()).toBe(403);expect((await download(page.request)).status()).toBe(403);}finally{sql(`update public.tenant_memberships set role='owner'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.owner.id}'`);}
 expect((await detail(page.request)).node.currentFile.versionId).toBe(currentVersion);
});

test('real completed upload with held application ACK locks handlers and retains field-free marker through departure until signed reconciliation',async({page})=>{
 await login(page);await page.goto(`/knowledge-base?company=${fixture.tenantA}`);await page.getByRole('button',{name:'Open base Synthetic files reference',exact:true}).click();await page.getByRole('button',{name:'Open folder Files',exact:true}).click();
 await page.evaluate(()=>{const original=window.fetch.bind(window);window.__kbCalls=[];window.fetch=async(...args)=>{window.__kbCalls.push({url:String(args[0]),method:args[1]?.method||'GET'});const response=await original(...args);if(String(args[0]).endsWith('/files')&&args[1]?.method==='POST'){const json=response.json.bind(response);response.json=async()=>{const ack=await json();window.__kbHeldSaved=ack.saved;window.__kbAckHeld=true;await new Promise(resolve=>{window.__releaseKbAck=resolve;});window.__kbAckReleased=true;return ack;};}return response;};});
 await page.getByRole('button',{name:'Add file',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Add file',exact:true});await dialog.getByLabel('Resource name',{exact:true}).fill('Synthetic held application acknowledgement');await dialog.getByLabel('Choose file',{exact:true}).setInputFiles({name:'held.txt',mimeType:'text/plain',buffer:Buffer.from('Genuine held acknowledgement bytes\n')});await dialog.getByRole('button',{name:'Save file',exact:true}).click();await expect.poll(()=>page.evaluate(()=>window.__kbAckHeld)).toBe(true);
 const markerKey=`ct-alt:knowledge-base:${fixture.accounts.owner.id}:${fixture.tenantA}`;const marker=await page.evaluate(key=>sessionStorage.getItem(key),markerKey);const parsed=JSON.parse(marker);expect(Object.keys(parsed).sort()).toEqual(['action','operationId']);expect(parsed.action).toBe('save_file');expect(sql(`select state from workforce_private.knowledge_file_attempts where tenant_id='${fixture.tenantA}'and actor_id='${fixture.accounts.owner.id}'and operation_id='${parsed.operationId}'`)).toBe('finalized');
 const calls=await page.evaluate(()=>window.__kbCalls.length);await page.getByRole('button',{name:'Refresh Knowledge Base',exact:true}).evaluate(button=>{const props=Object.keys(button).find(key=>key.startsWith('__reactProps$'));if(!props||typeof button[props].onClick!=='function')throw Error('Actual React refresh handler missing');button.disabled=false;button[props].onClick({preventDefault(){},stopPropagation(){},currentTarget:button,target:button});});
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));expect(await page.evaluate(()=>window.__kbCalls.length)).toBe(calls);expect(await page.evaluate(key=>sessionStorage.getItem(key),markerKey)).toBe(marker);
 await page.getByRole('link',{name:'Users',exact:true}).click();await expect(page).toHaveURL(/\/agents/);await expect(page.getByRole('heading',{name:'Knowledge Base',exact:true})).toHaveCount(0);await page.evaluate(()=>window.__releaseKbAck());await expect.poll(()=>page.evaluate(()=>window.__kbAckReleased)).toBe(true);expect(await page.evaluate(key=>sessionStorage.getItem(key),markerKey)).toBe(marker);
 await page.goto(`/knowledge-base?company=${fixture.tenantA}`);await expect(page.getByRole('region',{name:'Knowledge Base recovery',exact:true})).toBeVisible();const reconcile=page.waitForRequest(request=>request.method()==='POST'&&request.url().includes('/files/reconcile'));await page.getByRole('button',{name:'Refresh to recover',exact:true}).click();const recovery=await reconcile;expect(recovery.postDataJSON()).toEqual({tenantId:fixture.tenantA,operationId:parsed.operationId});await expect.poll(()=>page.evaluate(key=>sessionStorage.getItem(key),markerKey)).toBe(null);expect(sql(`select count(*) from workforce_private.knowledge_file_attempts where tenant_id='${fixture.tenantA}'and actor_id='${fixture.accounts.owner.id}'and operation_id='${parsed.operationId}'`)).toBe('1');
});

test('genuine provider completion held after successful preflight rechecks revoked original actor and cannot publish a file',async({page})=>{
 await login(page);const operationId=randomUUID(),value={...metadata,operationId,name:'Synthetic revoked delayed completion',expectedBaseRevision:(await base(page.request)).base.revision};
 const beforeNodes=sql(`select count(*) from public.knowledge_nodes where base_id='${baseId}'`);const beforeAllocation=JSON.parse(sql('select json_build_object(\'bytes\',allocated_bytes,\'attempts\',allocated_attempts)from workforce_private.knowledge_file_quota'));
 let holder,transfer,release;let restored=false;
 try{
  sql(`create schema ct_alt_file_barrier;create function ct_alt_file_barrier.pause_completion()returns trigger language plpgsql as $$begin if new.bucket_id='ct-alt-knowledge-base'and current_setting('role',true)='service_role'and current_setting('storage.operation',true)='storage.object.upload'and new.owner_id='${fixture.accounts.owner.id}'then perform pg_advisory_xact_lock(70123,90213);end if;return new;end$$;create trigger aaa_ct_alt_fixture_completion_pause before insert on storage.objects for each row execute function ct_alt_file_barrier.pause_completion();`);
  // This is a real separate transaction, held open until the actual provider INSERT waits.
  holder=spawn('docker',['exec','-i',db,'psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-U','postgres'],{stdio:['pipe','pipe','pipe']});
  const ready=new Promise((resolve,reject)=>{let output='';holder.stdout.on('data',chunk=>{output+=chunk;if(output.includes('CT_ALT_LOCK_READY'))resolve();});holder.once('error',reject);holder.once('exit',code=>{if(!output.includes('CT_ALT_LOCK_READY'))reject(Error('Owned completion barrier failed before ready: '+code));});});
  release=()=>{if(holder&&holder.exitCode===null){holder.stdin.end('commit;\n\\q\n');}};
  holder.stdin.write("begin;select pg_advisory_xact_lock(70123,90213);select 'CT_ALT_LOCK_READY';\n");await ready;
  transfer=upload(page.request,value);transfer.catch(()=>{});await expect.poll(()=>sql('select exists(select 1 from pg_locks where locktype=\'advisory\'and classid=70123 and objid=90213 and not granted);')).toBe('t');
  expect(sql(`select state from workforce_private.knowledge_file_attempts where operation_id='${operationId}'and actor_id='${fixture.accounts.owner.id}'`)).toBe('upload_attempted');
  sql(`update public.tenant_memberships set status='suspended'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.owner.id}'`);release();const response=await transfer;expect([403,409,503]).toContain(response.status());
  expect(sql(`select count(*) from public.knowledge_nodes where base_id='${baseId}'`)).toBe(beforeNodes);expect(sql(`select count(*) from storage.objects o join workforce_private.knowledge_file_attempts a on a.path=o.name where a.operation_id='${operationId}'and a.actor_id='${fixture.accounts.owner.id}'`)).toBe('0');
  const allocation=JSON.parse(sql('select json_build_object(\'bytes\',allocated_bytes,\'attempts\',allocated_attempts)from workforce_private.knowledge_file_quota'));expect(allocation.bytes).toBe(beforeAllocation.bytes+bytes.length);expect(allocation.attempts).toBe(beforeAllocation.attempts+1);
  expect((await recover(page.request,operationId)).status()).toBe(403);
 }finally{
  release?.();if(holder&&holder.exitCode===null)await new Promise(resolve=>holder.once('exit',resolve));
  if(transfer)await transfer.catch(()=>{});
  sql(`update public.tenant_memberships set status='active'where tenant_id='${fixture.tenantA}'and user_id='${fixture.accounts.owner.id}';drop trigger if exists aaa_ct_alt_fixture_completion_pause on storage.objects;drop schema if exists ct_alt_file_barrier cascade;`);restored=true;
 }
 expect(restored).toBe(true);const attempt=await(await recover(page.request,operationId)).json();expect(['upload_attempted','closed']).toContain(attempt.status);expect(attempt.capabilities.canFinalize).toBe(false);expect((await detail(page.request)).node.currentFile.versionId).toBe(currentVersion);
});
