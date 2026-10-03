import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import type { Agent } from '../../lib/agent-types';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local Auth required');
const origin='http://127.0.0.1:5180';
async function login(page:Page,role='owner') {
 const result=await page.request.post('/api/auth',{headers:{Origin:origin},data:{action:'login',email:f.accounts[role].email,password:f.accounts[role].password}});
 expect(result.status()).toBe(200);
}
async function directory(page:Page,tenant=f.tenantA):Promise<Agent[]> {
 const response=await page.request.get('/api/agents?tenantId='+tenant);expect(response.status()).toBe(200);return (await response.json()).agents;
}
const route=(id:string,tenant=f.tenantA)=>`/agents/${id}?company=${tenant}`;
test('directory links open a read-only addressable profile with calendar/custom data and mobile layout',async({page})=>{
 await login(page);const number='+4476'+Date.now().toString().slice(-9);
 const response=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'create',first_name:'Profile',last_name:'Synthetic',phone:number,title:'<script>ordinary text</script>',team:'North',employment_start_date:'2026-10-05',custom_fields:{client:'Demo profile client'}}]}});expect(response.status()).toBe(200);
 const before=await directory(page),agent=before.find(record=>record.phone===number)!;
 await page.goto('/agents?company='+f.tenantA);await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(number);await page.getByRole('link',{name:'View details for Profile Synthetic',exact:true}).click();
 await expect(page).toHaveURL(origin+route(agent.id));await expect(page.getByRole('heading',{name:'Profile Synthetic',exact:true})).toBeVisible();
 await expect(page.getByRole('region',{name:'Company related info'})).toContainText('5 Oct 2026');await expect(page.getByRole('region',{name:'Company related info'})).toContainText('<script>ordinary text</script>');await expect(page.getByRole('region',{name:'Company related info'})).toContainText('Demo profile client');
 await expect(page.getByRole('region',{name:'Company access'})).toContainText('No linked account');await expect(page.getByRole('region',{name:'Record information'})).toContainText('Synthetic owner');
 expect((await directory(page)).find(record=>record.id===agent.id)).toEqual(agent);await page.reload();await expect(page.getByRole('heading',{name:'Profile Synthetic',exact:true})).toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/profile-mobile.png',fullPage:true});
 await page.getByRole('link',{name:'Back to Users'}).click();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(number);await page.getByLabel('Choose columns').click();await page.getByLabel('First name',{exact:true}).uncheck();await expect(page.getByRole('link',{name:'View details for Profile Synthetic',exact:true})).toBeVisible();
});
test('manager can read profiles; employees see only their own linked active record and no other membership',async({page})=>{
 await login(page);const rows=await directory(page),employee=rows.find(record=>record.user_id===f.accounts.employee.id)!,owner=rows.find(record=>record.user_id===f.accounts.owner.id)!;
 await login(page,'manager');await page.goto(route(employee.id));await expect(page.getByRole('heading',{name:'Synthetic employee',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:/Edit|Save/})).toHaveCount(0);
 await login(page,'employee');const response=await page.goto(route(employee.id));expect(response?.headers()['cache-control']).toContain('no-store');await expect(page.getByRole('heading',{name:'Synthetic employee',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Company access'})).toContainText('Employee');await expect(page.getByRole('region',{name:'Record information'})).toContainText('Not available');
 await page.goto(route(owner.id));await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();await expect(page.getByRole('heading',{name:'Synthetic owner',exact:true})).toHaveCount(0);
 await page.goto(route(employee.id,f.tenantB));await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();
 await page.goto('/agents/not-a-uuid?company='+f.tenantA);await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();
 await page.goto('/agents/'+employee.id);await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();
 await login(page,'foreign');const foreign=(await directory(page,f.tenantB))[0];await page.goto(route(employee.id));await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();await page.goto(route(foreign.id,f.tenantB));await expect(page.getByRole('heading',{name:'Foreign foreign',exact:true})).toBeVisible();
 await login(page);await page.goto(route(foreign.id,f.tenantB));await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();
});
test('archived linked records are visible to directory roles but immediately unavailable to that employee',async({page})=>{
 await login(page);let employee=(await directory(page)).find(record=>record.user_id===f.accounts.employee.id)!;
 const result=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'archive',id:employee.id,revision:employee.revision}]}});expect(result.status()).toBe(200);
 try {
  await page.goto(route(employee.id));await expect(page.getByRole('heading',{name:'Synthetic employee',exact:true})).toBeVisible();await expect(page.getByRole('region',{name:'Company access'})).toContainText('Suspended');await expect(page.getByRole('region',{name:'Company access'})).toContainText('Archived');
  await login(page,'employee');await page.goto(route(employee.id));await expect(page.getByRole('heading',{name:'Agent details unavailable',exact:true})).toBeVisible();
 } finally {
  await login(page);employee=(await directory(page)).find(record=>record.id===employee.id)!;const restored=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'restore',id:employee.id,revision:employee.revision}]}});expect(restored.status()).toBe(200);
 }
});
