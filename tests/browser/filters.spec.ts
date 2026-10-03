import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { preferenceKey } from '../../lib/agent-filters';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local Auth required');
async function login(page:Page,role:string) {
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(f.accounts[role].email);await page.getByLabel('Password',{exact:true}).fill(f.accounts[role].password);await page.getByRole('button',{name:'Sign in',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Users',exact:true})).toBeVisible();
}
test('quick/advanced AND/OR, inclusive dates, remove/reset and CSV use the same full filtered directory',async({page})=>{
 await login(page,'owner');const suffix=Date.now().toString().slice(-8),north='North '+suffix,south='South '+suffix;
 const changes=Array.from({length:29},(_,i)=>({action:'create',first_name:'Filter '+suffix,last_name:'Person '+i.toString().padStart(2,'0'),phone:'+4477'+suffix+i.toString().padStart(2,'0'),title:i===28?'Assistant':'Supervisor',team:i===28?south:north,employment_start_date:i>=27?'2024-03-01':'2024-02-29',custom_fields:{client:'Client '+suffix}}));
 for(const batch of [changes.slice(0,25),changes.slice(25)])expect((await page.request.post('/api/agents',{headers:{Origin:'http://127.0.0.1:5180'},data:{tenantId:f.tenantA,changes:batch}})).status()).toBe(200);
 await page.reload();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(suffix);
 await page.getByLabel('Filter users',{exact:true}).click();const panel=page.getByRole('region',{name:'User filters'});
 await panel.getByRole('button',{name:'+ Add filter',exact:true}).click();await panel.getByLabel('Value filter 1',{exact:true}).selectOption(north);
 await expect(page.locator('.pagination')).toContainText('of 28');
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export visible users'}).click();
 const csv=readFileSync((await (await download).path())!,'utf8');expect(csv.trim().split('\r\n')).toHaveLength(29);expect(csv).toContain('Person 27');expect(csv).not.toContain('Person 28');
 await panel.getByRole('button',{name:'Advanced filters',exact:true}).click();
 await panel.getByRole('button',{name:'+ Add filter',exact:true}).click();
 await panel.getByLabel('Search fields',{exact:true}).fill('Employment');
 await panel.getByLabel('Field filter 2',{exact:true}).selectOption('employment_start_date');
 await panel.getByLabel('Operator filter 2',{exact:true}).selectOption('between');
 await panel.getByLabel('Start date filter 2',{exact:true}).fill('2024-03-01');await panel.getByLabel('End date filter 2',{exact:true}).fill('2024-03-01');
 await expect(page.locator('.pagination')).toContainText('of 1');await expect(page.locator('.table-scroll tbody')).toContainText('Person 27');
 await panel.getByRole('combobox',{name:'Match conditions',exact:true}).selectOption('or');await expect(page.locator('.pagination')).toContainText('of 29');
 await panel.getByRole('button',{name:'Switch to quick filters',exact:true}).click();await expect(panel).toContainText('These conditions need advanced filters');await expect(page.locator('.pagination')).toContainText('of 29');
 await panel.getByRole('button',{name:'Advanced filters',exact:true}).click();await panel.getByRole('button',{name:'Remove filter 2',exact:true}).click();
 await panel.getByRole('combobox',{name:'Match conditions',exact:true}).selectOption('and');await panel.getByRole('button',{name:'Switch to quick filters',exact:true}).click();
 await expect(panel.getByLabel('Value filter 1',{exact:true})).toHaveValue(north);await expect(page.locator('.pagination')).toContainText('of 28');
 await page.reload();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(suffix);await expect(page.locator('.pagination')).toContainText('of 28');
 await page.getByLabel('Filter users',{exact:true}).click();await panel.getByRole('button',{name:'Reset all',exact:true}).click();await expect(page.getByRole('searchbox',{name:'Search users',exact:true})).toHaveValue('');await expect(panel.getByLabel('Field filter 1',{exact:true})).toHaveCount(0);
 await page.setViewportSize({width:390,height:844});await panel.getByRole('button',{name:'Advanced filters',exact:true}).click();await panel.getByRole('button',{name:'+ Add filter',exact:true}).click();
 expect(await panel.evaluate(element=>element.getBoundingClientRect().width)).toBeGreaterThan(300);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
 await page.screenshot({path:'test-results/filters-mobile.png',fullPage:true});
});
test('custom fields, empty values and per-account preferences work for read-only managers',async({page})=>{
 await login(page,'manager');await page.getByLabel('Filter users',{exact:true}).click();const panel=page.getByRole('region',{name:'User filters'});
 await panel.getByRole('button',{name:'Advanced filters',exact:true}).click();await panel.getByRole('button',{name:'+ Add filter',exact:true}).click();
 await panel.getByLabel('Search fields',{exact:true}).fill('Client');await panel.getByLabel('Field filter 1',{exact:true}).selectOption('custom:client');await panel.getByLabel('Operator filter 1',{exact:true}).selectOption('contains');await panel.getByLabel('Value filter 1',{exact:true}).fill('Demo');
 await expect(page.locator('.table-scroll tbody')).not.toContainText('Foreign');await expect(page.getByRole('button',{name:/^Edit /})).toHaveCount(0);
 await page.reload();await page.getByLabel('Filter users',{exact:true}).click();await expect(panel.getByLabel('Value filter 1',{exact:true})).toHaveValue('Demo');
 await panel.getByLabel('Search fields',{exact:true}).fill('');await panel.getByLabel('Field filter 1',{exact:true}).selectOption('employment_start_date');await panel.getByLabel('Operator filter 1',{exact:true}).selectOption('empty');await expect(panel.getByLabel('Value filter 1',{exact:true})).toHaveCount(0);await expect(page.locator('.pagination')).not.toContainText('of 0');
 await page.getByLabel('Account menu').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();await login(page,'owner');await page.getByLabel('Filter users',{exact:true}).click();await expect(panel.getByLabel('Field filter 1',{exact:true})).toHaveCount(0);
 const key=preferenceKey(f.tenantB,f.accounts.owner.id);await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,mode:'advanced',join:'or',rules:[{id:'forged',field:'team',operator:'is',value:'South',end:''}]})),key);
 expect((await page.request.get('/api/agents?tenantId='+f.tenantB)).status()).toBe(403);
 await page.goto('/agents?company='+f.tenantB);await expect(page.getByText('Your account has no active access to this company.')).toBeVisible();
});

test('a removed saved custom field warns above the directory and export until explicitly reset',async({page})=>{
 await login(page,'owner');const key=preferenceKey(f.tenantA,f.accounts.owner.id);
 await page.evaluate(key=>localStorage.setItem(key,JSON.stringify({version:1,mode:'advanced',join:'and',rules:[{id:'removed-custom',field:'custom:retired',operator:'is',value:'No longer available',end:''}]})),key);
 await page.reload();const notice=page.locator('p[role=alert]').filter({hasText:'Some saved filter conditions were removed'});
 await expect(notice).toBeVisible();await expect(notice).toContainText('results and export may include more users');
 await page.reload();await expect(notice).toBeVisible();
 await page.getByLabel('Filter users',{exact:true}).click();const panel=page.getByRole('region',{name:'User filters'});
 await panel.getByRole('button',{name:'+ Add filter',exact:true}).click();await page.reload();await expect(notice).toBeVisible();
 await page.getByLabel('Filter users',{exact:true}).click();await panel.getByRole('button',{name:'Reset all',exact:true}).click();
 await expect(notice).toHaveCount(0);await page.reload();await expect(notice).toHaveCount(0);
});
