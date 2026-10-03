import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Agent } from '../../lib/agent-types';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local fixtures required');
const origin='http://127.0.0.1:5180';
async function login(page:Page,role='owner') {
 expect((await page.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:f.accounts[role].email,password:f.accounts[role].password}})).status()).toBe(200);
 await page.goto('/agents?company='+f.tenantA);await expect(page.getByRole('heading',{name:'Users',exact:true})).toBeVisible();
}
async function exported(page:Page,name:string) {
 const download=page.waitForEvent('download');await page.getByRole('button',{name,exact:true}).click();return readFileSync((await (await download).path())!,'utf8');
}
test('selection spans pages, select-all is page-scoped, and export uses only selected matching users',async({page})=>{
 await login(page);const suffix=Date.now().toString().slice(-8);
 const changes=Array.from({length:29},(_,i)=>({action:'create',first_name:'Selection '+suffix,last_name:'Person '+String(i).padStart(2,'0'),phone:'+4475'+suffix+String(i).padStart(2,'0'),title:'Synthetic',team:'Selection '+suffix,employment_start_date:null,custom_fields:{client:'Demo selection'}}));
 for(const batch of [changes.slice(0,25),changes.slice(25)])expect((await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:batch}})).status()).toBe(200);
 await page.reload();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(suffix);
 const all=page.getByRole('checkbox',{name:'Select all users on this page',exact:true});await all.check();await expect(page.getByRole('status')).toContainText('25 selected');
 await page.getByRole('button',{name:'Next page',exact:true}).click();await expect(all).not.toBeChecked();await page.getByRole('checkbox',{name:`Select Selection ${suffix} Person 25`,exact:true}).check();await expect(all).toHaveJSProperty('indeterminate',true);await expect(page.getByRole('status')).toContainText('26 selected');
 const selected=await exported(page,'Export selected users');expect(selected.trim().split('\r\n')).toHaveLength(27);expect(selected).toContain('Person 00');expect(selected).toContain('Person 25');expect(selected).not.toContain('Person 26');expect(selected).not.toContain('"Synthetic","owner",');
 await page.getByRole('button',{name:'Clear user selection',exact:true}).click();const matching=await exported(page,'Export visible users');expect(matching.trim().split('\r\n')).toHaveLength(30);expect(matching).toContain('Person 28');
 await all.check();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(suffix+' no match');await expect(page.getByRole('button',{name:'Export selected users',exact:true})).toHaveCount(0);await expect(all).toBeDisabled();
});
test('unjoined count comes from loaded active records and read-only manager selection performs no mutations',async({page})=>{
 await login(page,'manager');const response=await page.request.get('/api/agents?tenantId='+f.tenantA);expect(response.status()).toBe(200);const rows=(await response.json()).agents as Agent[];
 const count=rows.filter(agent=>agent.status==='active' && !agent.user_id).length;await expect(page.locator('.unjoined-count')).toHaveText(String(count));
 let writes=0;page.on('request',request=>{if(request.url()===origin+'/api/agents' && request.method()==='POST')writes++;});
 const employee=rows.find(agent=>agent.user_id===f.accounts.employee.id)!;await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(employee.phone);await page.getByRole('checkbox',{name:'Select Synthetic employee',exact:true}).check();const csv=await exported(page,'Export selected users');expect(csv.trim().split('\r\n')).toHaveLength(2);expect(csv).toContain('employee');
 await page.getByRole('button',{name:/Users haven’t joined yet/}).click();await expect(page.getByRole('button',{name:'Export selected users',exact:true})).toHaveCount(0);await expect(page.locator('.table-scroll tbody')).toContainText('No users match this view');expect(writes).toBe(0);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
});
