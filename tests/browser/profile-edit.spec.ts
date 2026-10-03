import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Agent, AgentInput } from '../../lib/agent-types';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local Auth required');
const origin='http://127.0.0.1:5180';
const input=(agent:Agent):AgentInput=>({first_name:agent.first_name,last_name:agent.last_name,phone:agent.phone,title:agent.title,team:agent.team,employment_start_date:agent.employment_start_date,custom_fields:agent.custom_fields});
async function login(page:Page,role='owner') {
 expect((await page.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:f.accounts[role].email,password:f.accounts[role].password}})).status()).toBe(200);
}
async function rows(page:Page):Promise<Agent[]> {return (await (await page.request.get('/api/agents?tenantId='+f.tenantA)).json()).agents;}
async function create(page:Page,name:string) {
 const phone='+4474'+Date.now().toString().slice(-9);
 const response=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'create',first_name:name,last_name:'Synthetic',phone,title:'Original',team:'North',employment_start_date:null,custom_fields:{client:'Demo edit'}}]}});expect(response.status()).toBe(200);return (await rows(page)).find(agent=>agent.phone===phone)!;
}
async function edit(page:Page,agent:Agent) {
 await page.goto(`/agents/${agent.id}?company=${f.tenantA}`);await page.getByRole('button',{name:'Edit user details',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Edit user details',exact:true});await expect(dialog).toBeVisible();return dialog;
}
async function audit(page:Page,id:string) {
 const auth=await page.request.post(f.url+'/auth/v1/token?grant_type=password',{headers:{apikey:f.key},data:{email:f.accounts.owner.email,password:f.accounts.owner.password}});expect(auth.status()).toBe(200);const token=(await auth.json()).access_token;
 const result=await page.request.get(f.url+'/rest/v1/agent_audit?select=actor_user_id,action,revision&tenant_id=eq.'+f.tenantA+'&agent_id=eq.'+id+'&order=revision',{headers:{apikey:f.key,Authorization:'Bearer '+token}});expect(result.status()).toBe(200);return result.json();
}
test('cancel and escape are read-only; validated explicit save keeps record identity and writes one authenticated audit event',async({page})=>{
 await login(page);const original=await create(page,'Editable');let dialog=await edit(page,original);
 await dialog.getByLabel('First name',{exact:true}).fill('Cancelled');await dialog.getByRole('button',{name:'Cancel',exact:true}).click();expect((await rows(page)).find(agent=>agent.id===original.id)).toEqual(original);expect((await audit(page,original.id)).length).toBe(1);
 await page.getByRole('button',{name:'Edit user details',exact:true}).click();dialog=page.getByRole('dialog',{name:'Edit user details',exact:true});await expect(dialog.getByLabel('First name',{exact:true})).toHaveValue('Editable');await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);
 await page.getByRole('button',{name:'Edit user details',exact:true}).click();dialog=page.getByRole('dialog',{name:'Edit user details',exact:true});await dialog.getByLabel('Client *',{exact:true}).fill('');await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toBeVisible();expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(original.revision);
 await dialog.getByLabel('Client *',{exact:true}).fill('Updated client');await dialog.getByLabel('First name',{exact:true}).fill('Saved');await dialog.getByLabel('Title',{exact:true}).fill('Updated title');await dialog.getByLabel('Employment Start Date',{exact:true}).fill('2026-10-05');await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/profile-edit-mobile.png',fullPage:true});
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog).toHaveCount(0);await expect(page.getByRole('heading',{name:'Saved Synthetic',exact:true})).toBeVisible();const saved=(await rows(page)).find(agent=>agent.id===original.id)!;
 expect(saved).toMatchObject({id:original.id,tenant_id:original.tenant_id,user_id:original.user_id,created_by:original.created_by,created_at:original.created_at,status:original.status,revision:original.revision+1,first_name:'Saved',title:'Updated title',employment_start_date:'2026-10-05',custom_fields:{client:'Updated client'}});
 const events=await audit(page,original.id);expect(events).toHaveLength(2);expect(events[1]).toEqual({actor_user_id:f.accounts.owner.id,action:'updated',revision:2});
});
test('concurrent edits retain the draft, reject stale writes and require current data before another save',async({page})=>{
 await login(page);const original=await create(page,'Concurrent');const dialog=await edit(page,original);await dialog.getByLabel('Title',{exact:true}).fill('My draft');
 expect((await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'update',id:original.id,revision:original.revision,...input(original),title:'Concurrent winner'}]}})).status()).toBe(200);
 await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('This agent changed');await expect(dialog.getByLabel('Title',{exact:true})).toHaveValue('My draft');await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);expect((await rows(page)).find(agent=>agent.id===original.id)?.title).toBe('Concurrent winner');expect((await audit(page,original.id))).toHaveLength(2);
 await dialog.getByRole('button',{name:'Discard draft and reload',exact:true}).click();await expect(page.getByRole('region',{name:'User details'})).toContainText('Concurrent winner');await page.getByRole('button',{name:'Edit user details',exact:true}).click();const current=page.getByRole('dialog',{name:'Edit user details',exact:true});await expect(current.getByLabel('Title',{exact:true})).toHaveValue('Concurrent winner');await current.getByLabel('Title',{exact:true}).fill('Reviewed final edit');await current.getByRole('button',{name:'Save changes',exact:true}).click();await expect(current).toHaveCount(0);expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(3);
});
test('a committed save with lost acknowledgement blocks a blind retry and cancel reloads the committed details',async({page})=>{
 await login(page);const original=await create(page,'Unconfirmed');const dialog=await edit(page,original);await dialog.getByLabel('Title',{exact:true}).fill('Committed without acknowledgement');
 await page.route('**/api/agents',async route=>{await route.fetch();await route.abort();});await dialog.getByRole('button',{name:'Save changes',exact:true}).click();await expect(dialog.getByRole('alert')).toContainText('outcome could not be confirmed');await expect(dialog.getByRole('button',{name:'Save changes',exact:true})).toHaveCount(0);await page.unroute('**/api/agents');expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(2);
 await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(page.getByRole('region',{name:'User details'})).toContainText('Committed without acknowledgement');expect((await audit(page,original.id))).toHaveLength(2);
});
test('manager and employee profile viewers never receive editor controls or server mutation permission',async({page})=>{
 await login(page);const original=await create(page,'Permissions'),employee=(await rows(page)).find(agent=>agent.user_id===f.accounts.employee.id)!;
 for(const [role,agent] of [['manager',original],['employee',employee]] as const) {
  await login(page,role);await page.goto(`/agents/${agent.id}?company=${f.tenantA}`);await expect(page.getByRole('button',{name:'Edit user details',exact:true})).toHaveCount(0);
  expect((await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'update',id:agent.id,revision:agent.revision,...input(agent),title:'Denied'}]}})).status()).toBe(403);
 }
});
