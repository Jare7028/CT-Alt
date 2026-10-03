import { test, expect, request as requests, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const f=JSON.parse(readFileSync('/tmp/ct-alt-local-fixtures.json','utf8'));
if(f.url!=='http://127.0.0.1:54821')throw new Error('Independent local Auth is required');
const app='http://127.0.0.1:5180';
function localSql(query:string){
 const r=spawnSync('docker',['exec','supabase_db_ct-alt-independent','psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','postgres','-c',query],{encoding:'utf8'});
 if(r.status!==0)throw new Error('Isolated fixture database command failed');return r.stdout.trim();
}
const counts=()=>localSql("select json_build_array((select count(*) from public.tenants),(select count(*) from public.tenant_memberships));");
async function mailLink(email:string) {
 let messages:{ID:string;To:{Address:string}[]}[]=[];
 await expect.poll(async()=>{
  const result=await fetch('http://127.0.0.1:54824/api/v1/messages?limit=1000');
  const inbox=await result.json();messages=inbox.messages.filter((message:{To:{Address:string}[]})=>message.To.some(recipient=>recipient.Address===email));return messages.length;
 },{timeout:10000}).toBeGreaterThan(0);
 const detail=await (await fetch(`http://127.0.0.1:54824/api/v1/message/${messages[0].ID}`)).json();
 const strings=(value:unknown):string[]=>typeof value==='string'?[value]:value&&typeof value==='object'?Object.values(value).flatMap(strings):[];
 const match=strings(detail).join('\n').match(/http:\/\/127\.0\.0\.1:54821\/auth\/v1\/verify\?[^"'<>\s]+/);
 if(!match)throw new Error('Local inbox did not contain an Auth verification link');
 return match[0].replaceAll('&amp;','&');
}
async function requestLink(page:Page,email:string) {
 await page.goto('/login');await page.getByRole('button',{name:'Email link',exact:true}).click();
 await page.getByLabel('Email',{exact:true}).fill(email);
 const result=page.waitForResponse(r=>r.url()===app+'/api/auth'&&r.request().method()==='POST');
 await page.getByRole('button',{name:'Email me a sign-in link',exact:true}).click();
 const response=await result;expect(response.status()).toBe(202);expect(response.headers()['retry-after']).toBe('60');
 await expect(page.getByRole('status')).toContainText('If email sign-in is available');
 await expect(page.getByRole('button',{name:/Request again in/})).toBeDisabled();
 return response.json();
}

test('new email confirms through actual local Auth; signup never grants company membership',async({page})=>{
 const before=counts(),email=`ct-alt-signup-${Date.now()}@example.test`;
 await requestLink(page,email);
 expect(localSql(`select email_confirmed_at is null from auth.users where email='${email}';`)).toBe('t');
 expect((await page.request.get('/api/agents?tenantId='+f.tenantA)).status()).toBe(401);
 const link=await mailLink(email);
 await page.goto(link);
 await expect(page.getByRole('heading',{name:'Company activation pending'})).toBeVisible();
 expect(localSql(`select email_confirmed_at is not null from auth.users where email='${email}';`)).toBe('t');
 expect((await page.request.get('/api/agents?tenantId='+f.tenantA)).status()).toBe(403);
 expect(counts()).toBe(before);
 const cookieNames=(await page.context().cookies()).filter(cookie=>cookie.name.startsWith('ct-alt-auth'));
 expect(cookieNames.length).toBeGreaterThan(0);expect(cookieNames.every(cookie=>cookie.httpOnly)).toBe(true);
 await page.goto(link);
 await expect(page.locator('p[role=alert]')).toContainText('This link could not be used');
 expect(counts()).toBe(before);
});

test('existing owner uses a magic link with identical response and keeps only existing access',async({page})=>{
 await requestLink(page,f.accounts.owner.email);
 const link=await mailLink(f.accounts.owner.email);
 await page.goto(link);
 await expect(page.getByRole('heading',{name:'Users',exact:true})).toBeVisible();
 expect((await page.request.get('/api/agents?tenantId='+f.tenantB)).status()).toBe(403);
 await page.getByLabel('Account menu').click();await page.getByRole('button',{name:'Sign out',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Sign in to your company'})).toBeVisible();
});

test('actual expired local email and callbacks without a matching PKCE browser fail safely',async({page,browser})=>{
 const email=`ct-alt-expired-${Date.now()}@example.test`,before=counts();
 await requestLink(page,email);const link=await mailLink(email);
 const context=await browser.newContext();const other=await context.newPage();
 // A structurally valid callback without the requester's verifier grants no session.
 await other.goto(app+'/auth/callback?code=12345678-1234-1234-1234-123456789abc&next=https://evil.example');
 await expect(other).toHaveURL(app+'/login?error=link');
 expect((await other.request.get('/api/agents?tenantId='+f.tenantA)).status()).toBe(401);
 // The real provider link also cannot establish a session in another browser.
 const requester=await browser.newContext();const requestingPage=await requester.newPage();
 const wrongBrowserEmail=`ct-alt-wrong-browser-${Date.now()}@example.test`;
 await requestLink(requestingPage,wrongBrowserEmail);await other.goto(await mailLink(wrongBrowserEmail));
 await expect(other.locator('p[role=alert]')).toContainText('This link could not be used');
 expect((await other.request.get('/api/agents?tenantId='+f.tenantA)).status()).toBe(401);
 await requester.close();await context.close();
 localSql(`update auth.users set confirmation_sent_at=now()-interval '2 days',recovery_sent_at=now()-interval '2 days' where email='${email}';`);
 await page.goto(link);await expect(page.locator('p[role=alert]')).toContainText('This link could not be used');
 expect((await page.request.get('/api/agents?tenantId='+f.tenantA)).status()).toBe(401);expect(counts()).toBe(before);
});

test('ordinary retry, provider limits and existing/new identities return the same public result',async()=>{
 const email=`ct-alt-limits-${Date.now()}@example.test`;
 const first=await requests.newContext({baseURL:app,extraHTTPHeaders:{Origin:app}}),second=await requests.newContext({baseURL:app,extraHTTPHeaders:{Origin:app}});
 try{
  const send=(client:typeof first,address=email)=>client.post('/api/auth',{data:{action:'email_link',email:address}});
  const accepted=await send(first);expect(accepted.status()).toBe(202);const body=await accepted.json();
  const retry=await send(first);expect(retry.status()).toBe(202);expect(await retry.json()).toEqual(body);
  const limited=await send(second);expect(limited.status()).toBe(202);expect(await limited.json()).toEqual(body);
  const cookie=(await first.storageState()).cookies.find(cookie=>cookie.name==='ct-alt-email-cooldown');expect(cookie?.httpOnly).toBe(true);
  expect((await first.post('/api/auth',{headers:{Origin:'https://foreign.example'},data:{action:'email_link',email}})).status()).toBe(403);
  expect((await first.post('/api/auth',{data:{action:'email_link',email,redirectTo:'https://evil.example'}})).status()).toBe(400);
 }finally{await first.dispose();await second.dispose();}
});
