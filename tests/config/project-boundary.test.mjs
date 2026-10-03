import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedSupabaseUrl, resolveSupabaseConfig, supabaseConfig, DEVELOPMENT_PUBLIC_CONFIG } from '../../lib/supabase-config.ts';
const hosted=DEVELOPMENT_PUBLIC_CONFIG.url,local='http://127.0.0.1:54821';
const publicKey='sb_publishable_synthetic_public_test_key_123456';
const jwt=p=>[Buffer.from('{}').toString('base64url'),Buffer.from(JSON.stringify(p)).toString('base64url'),'synthetic-signature'].join('.');
test('only CT Alt project and isolated local API are permitted',()=>{
 assert.equal(approvedSupabaseUrl(hosted),true);assert.equal(approvedSupabaseUrl(local),true);
 for(const url of [undefined,'https://another-project.supabase.co','http://127.0.0.1:54321',hosted+'.attacker.example','https://example.com',''])assert.equal(approvedSupabaseUrl(url),false);
});
test('absent overrides use the verified public development binding',()=>{
 assert.ok(DEVELOPMENT_PUBLIC_CONFIG.key.startsWith('sb_publishable_'));
 assert.deepEqual(resolveSupabaseConfig({}),DEVELOPMENT_PUBLIC_CONFIG);
 assert.deepEqual(resolveSupabaseConfig({url:'',key:''}),DEVELOPMENT_PUBLIC_CONFIG);
});
test('overrides require a complete approved pair; foreign config never falls back',()=>{
 assert.deepEqual(resolveSupabaseConfig({url:hosted,key:publicKey}),{url:hosted,key:publicKey});
 for(const overrides of [{url:hosted},{key:publicKey},{url:'https://another-project.supabase.co',key:publicKey},{url:'http://127.0.0.1:54321',key:publicKey}])assert.equal(resolveSupabaseConfig(overrides),null);
});
test('secret/service-role credentials and foreign URLs are rejected without network calls',()=>{
 let calls=0;const previous=globalThis.fetch;globalThis.fetch=()=>{calls++;throw new Error('Network forbidden');};
 try{
  for(const url of [hosted,local])for(const key of ['sb_secret_synthetic_privileged_key_123',jwt({iss:'supabase-demo',role:'service_role'}),jwt({iss:'supabase',role:'anon',ref:'foreign-project'}),'unrecognized-key',''])assert.equal(resolveSupabaseConfig({url,key}),null);
  assert.equal(resolveSupabaseConfig({url:'https://another-project.supabase.co',key:publicKey}),null);assert.equal(calls,0);
 }finally{globalThis.fetch=previous;}
});
test('legacy anonymous test key is accepted solely for the isolated local stack',()=>{
 const key=jwt({iss:'supabase-demo',role:'anon'});
 assert.deepEqual(resolveSupabaseConfig({url:local,key}),{url:local,key});assert.equal(resolveSupabaseConfig({url:hosted,key}),null);
});

test('an inherited foreign environment fails closed before any request',()=>{
 const url=process.env.NEXT_PUBLIC_SUPABASE_URL,key=process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
 try { process.env.NEXT_PUBLIC_SUPABASE_URL='https://another-project.supabase.co';process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=publicKey;assert.equal(supabaseConfig(),null); }
 finally { if(url===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_URL;else process.env.NEXT_PUBLIC_SUPABASE_URL=url;if(key===undefined)delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;else process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=key; }
});
