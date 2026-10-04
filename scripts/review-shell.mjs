// Local synthetic review only. This route is removed before the process exits.
import { mkdir, copyFile, rm } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';

const route = new URL('../app/shell-review/', import.meta.url);
const root = new URL('../', import.meta.url);
const baseURL = 'http://127.0.0.1:5181';
let server, browser;
try {
  await mkdir(route, { recursive: false });
} catch {
  throw new Error('app/shell-review already exists; remove only your temporary review route before running.');
}
try {
  await copyFile(new URL('../tests/fixtures/shell-review-page.tsx', import.meta.url), new URL('page.tsx', route));
  server = spawn('node', ['node_modules/next/dist/bin/next', 'dev', '--hostname', '127.0.0.1', '--port', '5181'], {
    cwd:root, env:{...process.env, NEXT_PUBLIC_SUPABASE_URL:'http://disabled.invalid', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'disabled'}, stdio:'inherit',
  });
  for(let attempt=0;attempt<60;attempt++) {
    try { if((await fetch(`${baseURL}/shell-review`)).ok) break; } catch {}
    if(attempt===59) throw new Error('Review server did not become ready');
    await setTimeout(500);
  }
  browser=await chromium.launch({executablePath:process.env.CT_ALT_CHROMIUM || '/usr/bin/chromium', args:['--no-sandbox']});
  const page=await browser.newPage();
  const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error')errors.push(message.text());});
  // The preview needs no services, external fonts or live data.
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1' ? route.continue() : route.abort());
  await mkdir(new URL('../docs/screenshots/',import.meta.url),{recursive:true});
  for(const [label,width,height] of [['desktop',1444,690],['mobile',390,844]]) {
    await page.setViewportSize({width,height});await page.goto(`${baseURL}/shell-review`);
    await page.getByRole('heading',{name:'Users',exact:true}).waitFor();await page.evaluate(()=>document.fonts.ready);
    await page.getByRole('tab',{name:/Admins/}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.table-scroll tbody tr').length===1);
    await page.getByRole('tab',{name:/Users/}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.table-scroll tbody tr').length===4);
    await page.addStyleTag({content:'nextjs-portal { display:none !important; }'});
    await page.getByLabel('Account menu').click();
    await page.getByRole('button',{name:'Sign out',exact:true}).waitFor({state:'visible'});
    await page.getByLabel('Account menu').click();
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${label} viewport overflow`);
    await page.screenshot({path:new URL(`../docs/screenshots/shell-after-${label}.png`,import.meta.url).pathname});
    const nav = label==='desktop' ? page.locator('.ct-sidebar nav') : page.getByRole('dialog',{name:'CT Alt navigation'}).getByRole('navigation');
    if(label==='mobile') {
      await page.getByRole('button',{name:'Open navigation'}).focus();await page.keyboard.press('Enter');
      await page.getByRole('dialog',{name:'CT Alt navigation'}).waitFor({state:'visible'});
      for(let step=0;step<15;step++) {
        await page.keyboard.press('Tab');
        assert.equal(await page.evaluate(()=>document.activeElement===document.body || Boolean(document.activeElement?.closest('dialog'))),true,'Drawer prevents focus on background controls');
      }
      await page.getByRole('dialog',{name:'CT Alt navigation'}).evaluate(el=>{el.scrollTop=0;});
      await page.screenshot({path:new URL('../docs/screenshots/shell-after-mobile-navigation.png',import.meta.url).pathname});
    }
    assert.equal(await nav.getByRole('link',{name:'Users',exact:true}).getAttribute('href'),'/agents?company=11111111-1111-4111-8111-111111111111');
    assert.equal(await nav.getByRole('link',{name:'Job scheduling',exact:true}).getAttribute('href'),'/rotas?company=11111111-1111-4111-8111-111111111111');
    for(const name of ['Communication','Operations','HR & Skills']) assert.ok(await nav.getByText(name,{exact:true}).count());
    assert.equal(await nav.getByRole('link',{name:'Chat',exact:true}).getAttribute('href'),'/chat?company=11111111-1111-4111-8111-111111111111','Released Chat retains current company navigation');
    if(label==='mobile') {
      await page.keyboard.press('Escape');
      assert.equal(await page.getByRole('button',{name:'Open navigation'}).evaluate(el=>el===document.activeElement),true,'Escape restores menu focus');
    } else {
      await page.getByRole('button',{name:'Collapse navigation'}).click();
      assert.equal(await page.locator('.ct-sidebar').evaluate(el=>el.getBoundingClientRect().width),60);
      await page.getByRole('button',{name:'Expand navigation'}).click();
      assert.equal(await page.locator('.ct-sidebar').evaluate(el=>el.getBoundingClientRect().width),196);
      await page.getByRole('link',{name:'Skip to content'}).focus();await page.keyboard.press('Enter');
      assert.equal(await page.locator('#ct-main-content').evaluate(el=>el===document.activeElement),true,'Skip link focuses content');
    }
    await page.getByRole('searchbox',{name:'Search users'}).fill('Taylor');
    assert.equal(await page.locator('.table-scroll tbody tr').count(),1,'Directory search remains working');
    await page.getByRole('searchbox',{name:'Search users'}).fill('');
    await page.getByRole('tab',{name:/Admins/}).click();
    assert.equal(await page.locator('.table-scroll tbody tr').count(),1,'Admins tab remains working');
    await page.getByRole('tab',{name:/Users/}).click();
    console.log(`${label}: no overflow; navigation, keyboard and directory checks passed`);
  }
  assert.deepEqual(errors,[],'Browser runtime errors');
} finally {
  await browser?.close();
  if(server && server.exitCode===null) {
    const closed=new Promise(resolve=>server.once('exit',resolve));server.kill('SIGTERM');await closed;
  }
  await rm(route,{recursive:true,force:true});
  // Dev type generation includes the temporary route; discard its stale cache.
  await rm(new URL('../.next/dev/types/',import.meta.url),{recursive:true,force:true});
}
