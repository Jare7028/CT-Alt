import { test, expect, request as requests, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local fixtures required');
const origin='http://127.0.0.1:5180';
const data={first_name:'API',last_name:'Synthetic',phone:'+447700900301',title:'',team:'',employment_start_date:null,custom_fields:{client:'Demo client'}};
async function login(role:string) {
 const client=await requests.newContext({baseURL:origin,extraHTTPHeaders:{Origin:origin}});
 const response=await client.post('/api/auth',{data:{action:'login',email:f.accounts[role].email,password:f.accounts[role].password}});
 expect(response.status()).toBe(200);return client;
}
const directory=(client:APIRequestContext,tenant=f.tenantA)=>client.get(`/api/agents?tenantId=${tenant}`);
const write=(client:APIRequestContext,changes:unknown[],tenant=f.tenantA)=>client.post('/api/agents',{data:{tenantId:tenant,changes}});

test('actual Auth sessions preserve company boundaries and manager/employee permissions',async()=>{
 const owner=await login('owner'),manager=await login('manager'),employee=await login('employee'),foreign=await login('foreign');
 try{
  const rows=await directory(owner);expect(rows.status()).toBe(200);expect(rows.headers()['cache-control']).toContain('no-store');
  expect((await rows.json()).agents.every((agent:{tenant_id:string})=>agent.tenant_id===f.tenantA)).toBe(true);
  expect((await directory(owner,f.tenantB)).status()).toBe(403);
  expect((await directory(foreign)).status()).toBe(403);
  expect((await directory(foreign,f.tenantB)).status()).toBe(200);
  expect((await directory(manager)).status()).toBe(200);
  expect((await write(manager,[{action:'create',...data}])).status()).toBe(403);
  expect((await directory(employee)).status()).toBe(403);
  expect((await write(employee,[{action:'create',...data}])).status()).toBe(403);
  expect((await write(owner,[{action:'create',...data,role:'owner'}])).status()).toBe(400);
  expect((await write(owner,[{action:'create',...data,custom_fields:{}}])).status()).toBe(400);
  expect((await owner.post('/api/agents',{headers:{Origin:'https://foreign.example'},data:{tenantId:f.tenantA,changes:[{action:'create',...data}]}})).status()).toBe(403);
 }finally{await Promise.all([owner,manager,employee,foreign].map(client=>client.dispose()));}
});

test('archive removes an existing admin session access; restore does not restore admin permissions',async()=>{
 const owner=await login('owner'),admin=await login('admin');
 try{
  expect((await directory(admin)).status()).toBe(200);
  let rows=(await (await directory(owner)).json()).agents;
  let agent=rows.find((a:{user_id:string})=>a.user_id===f.accounts.admin.id);
  const self=rows.find((a:{user_id:string})=>a.user_id===f.accounts.owner.id);
  expect((await write(owner,[{action:'archive',id:self.id,revision:self.revision}])).status()).toBe(403);
  expect((await write(owner,[{action:'archive',id:agent.id,revision:agent.revision}])).status()).toBe(200);
  expect((await directory(admin)).status()).toBe(403);
  expect((await write(owner,[{action:'restore',id:agent.id,revision:agent.revision}])).status()).toBe(409);
  rows=(await (await directory(owner)).json()).agents;agent=rows.find((a:{user_id:string})=>a.user_id===f.accounts.admin.id);
  expect((await write(owner,[{action:'restore',id:agent.id,revision:agent.revision}])).status()).toBe(200);
  expect((await directory(admin)).status()).toBe(403);
  expect((await write(admin,[{action:'create',...data}])).status()).toBe(403);
 }finally{await owner.dispose();await admin.dispose();}
});
