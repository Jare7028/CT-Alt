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
async function profile(page:Page,agent:Agent) {await page.goto(`/agents/${agent.id}?company=${f.tenantA}`);await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toBeVisible();}
async function field(page:Page,label:string) {await page.getByRole('button',{name:'Edit '+label,exact:true}).click();const input=page.getByLabel(label,{exact:true});await expect(input).toBeFocused();return input;}
async function audit(page:Page,id:string) {
 const auth=await page.request.post(f.url+'/auth/v1/token?grant_type=password',{headers:{apikey:f.key},data:{email:f.accounts.owner.email,password:f.accounts.owner.password}});expect(auth.status()).toBe(200);const token=(await auth.json()).access_token;
 const result=await page.request.get(f.url+'/rest/v1/agent_audit?select=actor_user_id,action,revision&tenant_id=eq.'+f.tenantA+'&agent_id=eq.'+id+'&order=revision',{headers:{apikey:f.key,Authorization:'Bearer '+token}});expect(result.status()).toBe(200);return result.json();
}
test('click-to-edit saves valid fields on blur, preserves identity and adds one authenticated audit event',async({page})=>{
 await login(page);const original=await create(page,'Editable');await profile(page,original);const title=await field(page,'Title');await title.fill('Blur saved title');expect((await rows(page)).find(agent=>agent.id===original.id)).toEqual(original);
 await title.press('Tab');await expect(page.getByRole('status')).toHaveText('Saved.');await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toHaveText('Blur saved title');const saved=(await rows(page)).find(agent=>agent.id===original.id)!;
 expect(saved).toMatchObject({id:original.id,tenant_id:original.tenant_id,user_id:original.user_id,created_by:original.created_by,created_at:original.created_at,status:original.status,revision:2,title:'Blur saved title'});const events=await audit(page,original.id);expect(events).toHaveLength(2);expect(events[1]).toEqual({actor_user_id:f.accounts.owner.id,action:'updated',revision:2});
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/profile-edit-mobile.png',fullPage:true});
});
test('invalid edits never write or navigate silently; Escape discards only the unsaved field and restores focus',async({page})=>{
 await login(page);const original=await create(page,'Validation');await profile(page,original);const name=await field(page,'First name');await name.fill('   ');await page.getByRole('link',{name:'Back to Users',exact:true}).click();await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('Enter first and last names');expect(page.url()).toContain('/agents/'+original.id);await expect(page.getByRole('region',{name:'Pending navigation'})).toBeVisible();expect((await rows(page)).find(agent=>agent.id===original.id)).toEqual(original);
 await page.getByRole('button',{name:'Stay on profile',exact:true}).click();await expect(name).toBeFocused();await name.press('Escape');await expect(name).toHaveCount(0);await expect(page.getByRole('button',{name:'Edit First name',exact:true})).toBeFocused();await expect(page.getByRole('button',{name:'Edit First name',exact:true})).toHaveText('Validation');
 const custom=await field(page,'Client');await custom.fill('');await custom.press('Tab');await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('valid Client');await expect(custom).toBeFocused();expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(1);await custom.press('Escape');expect((await audit(page,original.id))).toHaveLength(1);
 await page.getByRole('link',{name:'Back to Users',exact:true}).click();await expect(page).toHaveURL(origin+'/agents?company='+f.tenantA);
});
test('concurrent edits keep the typed value and reject stale blur saves until the latest record is reloaded',async({page})=>{
 await login(page);const original=await create(page,'Concurrent');await profile(page,original);const title=await field(page,'Title');await title.fill('My draft');expect((await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'update',id:original.id,revision:1,...input(original),title:'Concurrent winner'}]}})).status()).toBe(200);
 await title.press('Tab');await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('This agent changed');await expect(title).toHaveValue('My draft');await expect(title).toBeDisabled();expect((await rows(page)).find(agent=>agent.id===original.id)?.title).toBe('Concurrent winner');expect((await audit(page,original.id))).toHaveLength(2);
 await page.getByRole('button',{name:'Reload latest details',exact:true}).click();await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toHaveText('Concurrent winner');const current=await field(page,'Title');await current.fill('Reviewed final edit');await current.press('Tab');await expect(page.getByRole('status')).toHaveText('Saved.');expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(3);
});
test('a committed blur save with lost acknowledgement blocks blind retry and requires a fresh read',async({page})=>{
 await login(page);const original=await create(page,'Unconfirmed');await profile(page,original);const title=await field(page,'Title');await title.fill('Committed without acknowledgement');await page.route('**/api/agents',async route=>{await route.fetch();await route.abort();});await title.press('Tab');await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('save outcome is unknown');await expect(title).toBeDisabled();await expect(page.getByRole('button',{name:'Edit First name',exact:true})).toBeDisabled();await page.unroute('**/api/agents');expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(2);
 await page.getByRole('button',{name:'Reload latest details',exact:true}).click();await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toHaveText('Committed without acknowledgement');await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toBeEnabled();expect((await audit(page,original.id))).toHaveLength(2);
});
test('profile-link navigation waits for acknowledgement and another field cannot create an overlapping write',async({page})=>{
 await login(page);const original=await create(page,'Navigation');await profile(page,original);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/agents',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});});
 try {
  const title=await field(page,'Title');await title.fill('Saved before leaving');await page.getByRole('link',{name:'Back to Users',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Saving…');await expect(page.getByRole('region',{name:'Pending navigation'})).toContainText('Waiting for this save');expect(page.url()).toContain('/agents/'+original.id);await page.getByRole('button',{name:'Edit Team',exact:true}).click();expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(2);release();await expect(page).toHaveURL(origin+'/agents?company='+f.tenantA);expect((await audit(page,original.id))).toHaveLength(2);
 } finally {release();await page.unroute('**/api/agents');}
});
test('native Back keeps the save alive and a lost acknowledgement requires review on the next profile visit',async({page})=>{
 await login(page);const original=await create(page,'NativeBack');await page.goto('/agents?company='+f.tenantA);await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(original.phone);await page.getByRole('link',{name:'View details for NativeBack Synthetic',exact:true}).click();await expect(page).toHaveURL(origin+`/agents/${original.id}?company=${f.tenantA}`);
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/agents',async route=>{await route.fetch();await gate;await route.abort();});
 try {
  const title=await field(page,'Title');await title.fill('Saved during native Back');await page.goBack();await expect(page).toHaveURL(origin+'/agents?company='+f.tenantA);await expect.poll(async()=>(await rows(page)).find(agent=>agent.id===original.id)?.title).toBe('Saved during native Back');release();await page.goForward();await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('earlier save outcome');await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toBeDisabled();await page.unroute('**/api/agents');await page.getByRole('button',{name:'Reload latest details',exact:true}).click();await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toHaveText('Saved during native Back');await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toBeEnabled();expect((await audit(page,original.id))).toHaveLength(2);
 } finally {release();await page.unroute('**/api/agents');}
});
for (const departure of ['explicit leave','browser Back'] as const) {
 test(`an acknowledged save followed by a committed lost acknowledgement retains unknown recovery after ${departure} and return`,async({page})=>{
  await login(page);const name=departure==='explicit leave'?'RecoveryLeave':'RecoveryBack',original=await create(page,name);
  await page.goto('/agents?company='+f.tenantA);await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(original.phone);await page.getByRole('link',{name:`View details for ${name} Synthetic`,exact:true}).click();
  const title=await field(page,'Title');await title.fill('Acknowledged title');await title.press('Tab');await expect(page.getByRole('status')).toHaveText('Saved.');
  const key=`ct-alt:profile-outcome:v1:${f.accounts.owner.id}:${f.tenantA}:${original.id}`;
  const outcome=()=>page.evaluate(storageKey=>JSON.parse(sessionStorage.getItem(storageKey) || 'null'),key);
  expect(await outcome()).toEqual({status:'saved',revision:2});
  const team=await field(page,'Team');await team.fill('Committed unacknowledged team');
  await page.route('**/api/agents',async route=>{await route.fetch();await route.abort();});
  await team.press('Tab');await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('save outcome is unknown');await page.unroute('**/api/agents');
  expect((await rows(page)).find(agent=>agent.id===original.id)).toMatchObject({title:'Acknowledged title',team:'Committed unacknowledged team',revision:3});
  expect(await outcome()).toEqual({status:'unknown',revision:2});
  if(departure==='explicit leave') {
   await page.getByRole('link',{name:'Back to Users',exact:true}).click();await expect(page.getByRole('region',{name:'Pending navigation'})).toBeVisible();await page.getByRole('button',{name:'Leave without further changes',exact:true}).click();
  } else await page.goBack();
  await expect(page).toHaveURL(origin+'/agents?company='+f.tenantA);expect(await outcome()).toEqual({status:'unknown',revision:2});
  if(departure==='browser Back')await page.goForward();else await profile(page,original);
  await expect(page.locator('.profile-editor').getByRole('alert')).toContainText(/save outcome (?:is unknown|was not confirmed)/);await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('before editing');await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toBeDisabled();await expect(page.getByRole('button',{name:'Edit Team',exact:true}).or(page.getByRole('textbox',{name:'Team',exact:true}))).toBeDisabled();expect(await outcome()).toEqual({status:'unknown',revision:2});
  await page.getByRole('button',{name:'Reload latest details',exact:true}).click();await expect(page.getByRole('button',{name:'Edit Title',exact:true})).toHaveText('Acknowledged title');await expect(page.getByRole('button',{name:'Edit Team',exact:true})).toHaveText('Committed unacknowledged team');await expect(page.getByRole('button',{name:'Edit Team',exact:true})).toBeEnabled();expect((await audit(page,original.id))).toHaveLength(3);
 });
}
test('manager and employee profile viewers have no field-edit controls or server mutation permission',async({page})=>{
 await login(page);const original=await create(page,'Permissions'),employee=(await rows(page)).find(agent=>agent.user_id===f.accounts.employee.id)!;
 for(const [role,agent] of [['manager',original],['employee',employee]] as const) {await login(page,role);await page.goto(`/agents/${agent.id}?company=${f.tenantA}`);await expect(page.getByRole('button',{name:/^Edit /})).toHaveCount(0);expect((await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'update',id:agent.id,revision:agent.revision,...input(agent),title:'Denied'}]}})).status()).toBe(403);}
});
test('moving between fields serializes blur saves and reuses the confirmed revision without losing either change',async({page})=>{
 await login(page);const original=await create(page,'Sequential');await profile(page,original);let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});await page.route('**/api/agents',async route=>{const response=await route.fetch();await gate;await route.fulfill({response});});
 try {const title=await field(page,'Title');await title.fill('First field saved');await page.getByRole('button',{name:'Edit Team',exact:true}).click();await expect(page.getByRole('status')).toHaveText('Saving…');release();const team=page.getByLabel('Team',{exact:true});await expect(team).toBeFocused();await team.fill('Second field saved');await team.press('Enter');await expect(page.getByRole('status')).toHaveText('Saved.');expect((await rows(page)).find(agent=>agent.id===original.id)).toMatchObject({title:'First field saved',team:'Second field saved',revision:3});expect((await audit(page,original.id))).toHaveLength(3);}finally{release();await page.unroute('**/api/agents');}
});
test('calendar dates stay calendar values and invalid international phones do not submit',async({page})=>{
 await login(page);const original=await create(page,'FieldValidation');await profile(page,original);const phone=await field(page,'Mobile phone');await phone.fill('0701234567');await phone.press('Tab');await expect(page.locator('.profile-editor').getByRole('alert')).toContainText('full international format');expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(1);await phone.press('Escape');
 const date=await field(page,'Employment Start Date');await date.fill('2026-10-05');expect((await rows(page)).find(agent=>agent.id===original.id)?.revision).toBe(1);await date.blur();await expect(page.getByRole('status')).toHaveText('Saved.');await expect(page.getByRole('button',{name:'Edit Employment Start Date',exact:true})).toHaveText('5 Oct 2026');expect((await rows(page)).find(agent=>agent.id===original.id)).toMatchObject({employment_start_date:'2026-10-05',revision:2});
});
