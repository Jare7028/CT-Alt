// Original UI with isolated synthetic fixtures; no Auth or external services.
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const root=new URL('../',import.meta.url),route=new URL('../app/overview-review/',import.meta.url);
const baseURL='http://127.0.0.1:5181';
const tenantA='11111111-1111-4111-8111-111111111111';
let server,browser;
const event=(id,action='created',actor_name='Alex Demo')=>({id,action,actor_name,agent_name:'Taylor Example',agent_id:'33333333-3333-4333-8333-333333333333',actor_user_id:'44444444-4444-4444-8444-444444444444',revision:1,occurred_at:'2026-10-03T23:30:00Z'});
async function capture(page,name) {
 const style=await page.addStyleTag({content:'[aria-label="Synthetic review controls"]{display:none!important}'});
 await page.screenshot({path:new URL(`../tests/visual-reference/${name}.png`,import.meta.url).pathname,fullPage:true});
 await style.evaluate(el=>el.remove());
}
await mkdir(route,{recursive:false});
try {
 await copyFile(new URL('../tests/fixtures/overview-activity-review-page.tsx',import.meta.url),new URL('page.tsx',route));
 server=spawn('node',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','5181'],{cwd:root,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://disabled.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'disabled'},stdio:'inherit'});
 for(let attempt=0;attempt<60;attempt++){try{if((await fetch(`${baseURL}/overview-review`)).ok)break;}catch{}if(attempt===59)throw new Error('Preview server did not start');await setTimeout(500);}
 browser=await chromium.launch({executablePath:process.env.CT_ALT_CHROMIUM||'/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
 let mode='normal',release;let requestCount=0;
 await page.route('**/*',async request=>{
  const url=new URL(request.request().url());if(url.hostname!=='127.0.0.1')return request.abort();
  if(!url.pathname.startsWith('/api/'))return request.continue();
  requestCount++;assert.equal(request.request().method(),'GET');
  if(mode==='delay'){await new Promise(resolve=>{release=resolve;});try{return await request.fulfill({json:{events:[event('999','created','Stale actor')],nextCursor:null}});}catch{return;}}
  if(mode==='error')return request.fulfill({status:403,json:{error:'Forbidden'}});
  if(url.pathname==='/api/overview')return request.fulfill({json:{company:{id:url.searchParams.get('tenantId'),name:'Northstar Demo',time_zone:'Europe/London',status:'active'},role:'owner',canViewActivity:true,agents:{active:16,archived:3,linked:10,unlinked:6},memberships:{owner:1,admin:2,manager:1,employee:10},recentActivity:[event('9007199254740993')]}});
  if(url.searchParams.has('cursor'))return request.fulfill({json:{events:[event('9007199254740993'),event('9007199254740992','updated')],nextCursor:null}});
  return request.fulfill({json:{events:url.searchParams.get('action')==='archived'?[]:[event('9007199254740993',url.searchParams.get('action')||'created')],nextCursor:null}});
 });
 await mkdir(new URL('../tests/visual-reference/',import.meta.url),{recursive:true});
 for(const [label,width,height] of [['desktop',1444,1000],['tablet',900,1000],['mobile',390,1000]]) {
  mode='normal';await page.setViewportSize({width,height});await page.goto(`${baseURL}/overview-review`);await page.getByRole('heading',{name:'Overview',exact:true}).waitFor();await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label}: overview no page overflow`);
  assert.equal(await page.locator('.overview-metric').filter({has:page.getByRole('heading',{name:'Active users',exact:true})}).locator('strong').textContent(),'12');
  assert.ok((await page.getByRole('link',{name:'View users',exact:false}).first().getAttribute('href')).includes(`company=${tenantA}`));
  await capture(page,`overview-${label}`);
  await page.getByRole('button',{name:'Refresh overview',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.overview-metric strong')?.textContent==='16');
  mode='error';await page.getByRole('button',{name:'Refresh overview',exact:true}).click();await page.locator('.overview-error').waitFor();assert.equal(await page.locator('.overview-metric').count(),0,'Failed access read clears metrics');
  await page.getByRole('button',{name:'Review Activity',exact:true}).click();mode='normal';
  await page.getByRole('heading',{name:'Activity',exact:true}).waitFor();assert.ok((await page.locator('.activity-log time').textContent()).includes('4 Oct 2026'),'Company-local timestamp crosses UTC date boundary');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label}: activity no page overflow`);
  await capture(page,`activity-${label}`);
  await page.getByRole('button',{name:'Load older activity',exact:true}).click();await page.waitForFunction(()=>document.querySelectorAll('.activity-log li').length===2);assert.equal(await page.getByRole('button',{name:'Load older activity',exact:true}).count(),0,'Pagination completes and deduplicates');
  await page.getByLabel('Action',{exact:true}).selectOption('archived');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.getByText('No activity to show',{exact:true}).waitFor();
  await page.getByLabel('Start date',{exact:true}).fill('2026-10-04');await page.getByLabel('End date',{exact:true}).fill('2026-10-03');const before=requestCount;await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.locator('.activity-error').waitFor();assert.equal(requestCount,before,'Invalid range never sends a request');
  await page.getByRole('button',{name:'Clear filters',exact:true}).click();await page.locator('.activity-log li').waitFor();
  mode='error';await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.locator('.activity-error').waitFor();assert.equal(await page.locator('.activity-log li').count(),0,'Failed access read clears activity');mode='normal';await page.getByRole('button',{name:'Refresh activity',exact:true}).click();await page.locator('.activity-log li').waitFor();
  mode='delay';release=undefined;await page.getByLabel('Action',{exact:true}).selectOption('updated');await page.getByRole('button',{name:'Apply filters',exact:true}).click();for(let count=0;!release&&count<40;count++)await setTimeout(25);assert.ok(release);const releaseFilter=release;mode='normal';await page.getByLabel('Action',{exact:true}).selectOption('restored');await page.getByRole('button',{name:'Apply filters',exact:true}).click();await page.locator('.activity-tag').filter({hasText:'Restored user'}).waitFor();releaseFilter();assert.equal(await page.getByText('Stale actor',{exact:true}).count(),0,'Filter switch fences delayed response');
  mode='delay';release=undefined;await page.getByLabel('Action',{exact:true}).selectOption('updated');await page.getByRole('button',{name:'Apply filters',exact:true}).click();for(let count=0;!release&&count<40;count++)await setTimeout(25);assert.ok(release);
  await page.getByRole('button',{name:'Switch demo company',exact:true}).click();release();await page.getByText('Blair Demo',{exact:true}).waitFor();assert.equal(await page.getByText('Stale actor',{exact:true}).count(),0,'Company switch fences delayed response');
  await page.getByRole('button',{name:'Switch demo role',exact:true}).click();await page.getByText('The activity log is available to company owners and admins.',{exact:true}).waitFor();assert.equal(await page.locator('.activity-log li').count(),0,'Manager sees no audit events');
  console.log(`${label}: overflow, real summary labels, refresh/revocation, local time, pagination, filters, stale company responses and role visibility passed`);
 }
 assert.deepEqual(errors,[],'No browser runtime errors');
}finally{await browser?.close();if(server&&server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;}await rm(route,{recursive:true,force:true});await rm(new URL('../.next/dev/types/',import.meta.url),{recursive:true,force:true});}
