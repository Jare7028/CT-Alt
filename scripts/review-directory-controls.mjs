// Synthetic local review. Start only with no other dev server in this checkout.
import { mkdir, copyFile, rm, readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
const route=new URL('../app/shell-review/',import.meta.url);
const root=new URL('../',import.meta.url);
const baseURL='http://127.0.0.1:5181';
let server,browser;
await mkdir(route,{recursive:false});
try {
 await copyFile(new URL('../tests/fixtures/controls-review-page.tsx',import.meta.url),new URL('page.tsx',route));
 server=spawn('node',['node_modules/next/dist/bin/next','dev','--hostname','127.0.0.1','--port','5181'],{cwd:root,env:{...process.env,NEXT_PUBLIC_SUPABASE_URL:'http://disabled.invalid',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'disabled'},stdio:'inherit'});
 for(let attempt=0;attempt<60;attempt++) {
  try{if((await fetch(`${baseURL}/shell-review`)).ok)break;}catch{}
  if(attempt===59)throw new Error('Review server did not become ready');
  await setTimeout(500);
 }
 browser=await chromium.launch({executablePath:process.env.CT_ALT_CHROMIUM || '/usr/bin/chromium',args:['--no-sandbox']});
 const page=await browser.newPage();const errors=[];
 page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
 await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.abort());
 for(const [label,width,height] of [['desktop',1184,760],['mobile',390,844]]) {
  await page.setViewportSize({width,height});await page.goto(`${baseURL}/shell-review`);
  await page.getByRole('tab',{name:/Admins/}).click();await page.waitForFunction(()=>document.querySelectorAll('.table-scroll tbody tr').length===1);
  await page.getByRole('tab',{name:/Users/}).click();await page.waitForFunction(()=>document.querySelectorAll('.table-scroll tbody tr').length===25);
  await page.addStyleTag({content:'nextjs-portal{display:none!important}'});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'No viewport overflow');
  await page.screenshot({path:new URL(`../tests/visual-reference/controls-after-${label}.png`,import.meta.url).pathname});
  if(label==='desktop') {
   const card=await page.locator('.directory-card').boundingBox();
   assert.equal(card.width,1084);
   const first=await page.getByRole('button',{name:'First name',exact:true}).boundingBox();
   const last=await page.getByRole('button',{name:'Last name',exact:true}).boundingBox();
   assert.equal(first.x-card.x,139);assert.equal(last.x-card.x,240);
   await page.screenshot({path:new URL('../tests/visual-reference/controls-after-crop.png',import.meta.url).pathname,clip:{x:card.x,y:card.y,width:card.width,height:173}});
   console.log('1084px card: First name x139; Last name x240; 15px table inset');
  }
  await page.getByRole('button',{name:'Next page',exact:true}).click();
  const download=page.waitForEvent('download');await page.getByRole('button',{name:'Export all matching users',exact:true}).click();
  const csv=await readFile(await (await download).path(),'utf8');assert.equal(csv.trim().split('\r\n').length,374,'Export includes all 373 matching users across pages');
  await page.getByLabel('Select all users on this page').check();
  const selectedDownload=page.waitForEvent('download');await page.getByRole('button',{name:'Export selected users',exact:true}).click();
  const selectedCsv=await readFile(await (await selectedDownload).path(),'utf8');assert.equal(selectedCsv.trim().split('\r\n').length,26,'Selection still exports 25 selected rows');
  await page.getByRole('button',{name:'Clear user selection'}).click();
  await page.getByLabel('Choose columns').click();await page.getByLabel('First name',{exact:true}).uncheck();
  assert.equal(await page.getByRole('columnheader',{name:'First name',exact:true}).count(),0,'Hidden-column colgroup tracks displayed fields');
  await page.getByRole('link',{name:/View details for/}).first().waitFor({state:'visible'});
  console.log(`${label}: overflow, export across pages, selection and hidden-column checks passed`);
 }
 assert.deepEqual(errors,[],'No browser errors');
}finally {
 await browser?.close();
 if(server && server.exitCode===null){const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;}
 await rm(route,{recursive:true,force:true});await rm(new URL('../.next/dev/types/',import.meta.url),{recursive:true,force:true});
}
