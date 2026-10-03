import { test, expect, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local Auth required');
const origin='http://127.0.0.1:5180';
async function login(page:Page,role='owner') {
 await page.goto('/login');await page.getByLabel('Email',{exact:true}).fill(f.accounts[role].email);await page.getByLabel('Password',{exact:true}).fill(f.accounts[role].password);await page.getByRole('button',{name:'Sign in',exact:true}).click();await expect(page.getByRole('heading',{name:'Users',exact:true})).toBeVisible();
}
async function openImport(page:Page,csv:string) {
 await page.getByText('Add users',{exact:false}).first().click();await page.getByRole('button',{name:'Import users',exact:true}).click();
 const dialog=page.getByRole('dialog',{name:'Import users',exact:true});await expect(dialog).toBeVisible();await dialog.getByLabel('CSV file',{exact:true}).setInputFiles({name:'synthetic.csv',mimeType:'text/csv',buffer:Buffer.from(csv,'utf8')});return dialog;
}
const directory=async(page:Page)=>(await (await page.request.get('/api/agents?tenantId='+f.tenantA)).json()).agents as {phone:string;first_name:string;custom_fields:Record<string,string>}[];
const phone=()=>'+4477'+Date.now().toString().slice(-9);
test('CSV mapping/preview is read-only until explicit confirmation; existing numbers skip and strings remain inert',async({page})=>{
 await login(page);const number=phone(),before=await directory(page);const existing=before.find(agent=>agent.phone==='+447700900201')!;
 const csv='\uFEFFFirst name,Last name,Mobile phone,Company,Unknown,Title\r\n"=1+1","Zoë, 李",'+number+',"Demo \"\"client\"\"",ignored,"First\r\nSecond"\r\n,,+447700900201,,,\r\n';
 const dialog=await openImport(page,csv);await expect(dialog.getByRole('button',{name:'Review import',exact:true})).toBeDisabled();await dialog.getByLabel('Map column Company',{exact:true}).selectOption('custom:client');
 await expect(dialog).toContainText('Skip existing user');await expect(dialog).toContainText('1 new users; 1 existing users');
 expect((await directory(page)).length).toBe(before.length);await dialog.getByRole('button',{name:'Review import',exact:true}).click();await expect(dialog.getByRole('region',{name:'Import summary'})).toBeVisible();expect((await directory(page)).length).toBe(before.length);
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);await page.screenshot({path:'test-results/import-mobile.png',fullPage:true});
 await dialog.getByRole('button',{name:'Confirm add-only import',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Import complete'})).toBeVisible();await expect(dialog).toContainText('1 new users added. 1 existing users skipped.');
 const after=await directory(page);expect(after.length).toBe(before.length+1);expect(after.find(agent=>agent.phone===number)?.first_name).toBe('=1+1');expect(after.find(agent=>agent.phone===number)?.custom_fields.client).toBe('Demo "client"');expect(after.find(agent=>agent.phone===existing.phone)?.first_name).toBe(existing.first_name);
 await dialog.getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('searchbox',{name:'Search users',exact:true}).fill(number);
 const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export visible users'}).click();const exported=readFileSync((await (await download).path())!,'utf8');expect(exported).toContain('"\'=1+1"');expect(exported).toContain('"Zoë, 李"');
});
test('duplicate/missing/invalid rows block review; a race conflict rejects the entire authorized batch',async({page})=>{
 await login(page);const number=phone();let dialog=await openImport(page,'First name,Last name,Mobile phone,Client\nAda,One,'+number+',Demo\nBen,Two,'+number+',Demo');
 await expect(dialog).toContainText('Duplicate mobile number within this file');await expect(dialog.getByRole('button',{name:'Review import',exact:true})).toBeDisabled();await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
 const second=number.slice(0,-1)+(Number(number.slice(-1))+1)%10;
 dialog=await openImport(page,'First name,Last name,Mobile phone,Client\nAda,One,'+number+',Demo\nBen,Two,'+second+',Demo');await dialog.getByRole('button',{name:'Review import',exact:true}).click();
 const raced=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'create',first_name:'Concurrent',last_name:'Synthetic',phone:second,title:'',team:'',employment_start_date:null,custom_fields:{client:'Demo'}}]}});expect(raced.status()).toBe(200);
 await dialog.getByRole('button',{name:'Confirm add-only import',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Import not applied'})).toBeVisible();await expect(dialog).toContainText('No users were added by this batch');expect((await directory(page)).some(agent=>agent.phone===number)).toBe(false);
});
test('a committed import with failed refresh reports success, and an unconfirmed response never invites a blind retry',async({page})=>{
 await login(page);const number=phone();let dialog=await openImport(page,'First name,Last name,Mobile phone,Client\nRefresh,Example,'+number+',Demo');await dialog.getByRole('button',{name:'Review import',exact:true}).click();
 await page.route('**/api/agents?tenantId=*',route=>route.abort());await dialog.getByRole('button',{name:'Confirm add-only import',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Import complete'})).toBeVisible();await expect(dialog).toContainText('Users were imported, but the directory could not be refreshed');expect((await directory(page)).some(agent=>agent.phone===number)).toBe(true);await page.unroute('**/api/agents?tenantId=*');await dialog.getByRole('button',{name:'Close',exact:true}).click();
 const unknown=phone();dialog=await openImport(page,'First name,Last name,Mobile phone,Client\nUnknown,Example,'+unknown+',Demo');await dialog.getByRole('button',{name:'Review import',exact:true}).click();
 await page.route('**/api/agents',async route=>{await route.fetch();await route.abort();});await dialog.getByRole('button',{name:'Confirm add-only import',exact:true}).click();await expect(dialog.getByRole('heading',{name:'Check import outcome'})).toBeVisible();await expect(dialog).toContainText('Do not repeat the import');await expect(dialog.getByRole('button',{name:'Confirm add-only import',exact:true})).toHaveCount(0);await page.unroute('**/api/agents');expect((await directory(page)).some(agent=>agent.phone===unknown)).toBe(true);
});
test('manager cannot import through either the UI or the signed-user API',async({page})=>{
 await login(page,'manager');await expect(page.getByRole('button',{name:'Import users',exact:true})).toHaveCount(0);
 const result=await page.request.post('/api/agents',{headers:{Origin:origin},data:{tenantId:f.tenantA,changes:[{action:'create',first_name:'Denied',last_name:'Synthetic',phone:phone(),title:'',team:'',employment_start_date:null,custom_fields:{client:'Demo'}}]}});expect(result.status()).toBe(403);
});
