import test from 'node:test';import assert from 'node:assert/strict';
import { authOrigin, callbackUrl, safeAuthDestination, callbackCode, validCallbackOrigin } from '../../lib/auth-redirects.ts';
test('callbacks use fixed owned origins and never request-controlled hosts',()=>{
 assert.equal(callbackUrl({url:'http://127.0.0.1:54821',key:'synthetic'}),'http://127.0.0.1:5180/auth/callback');
 assert.equal(authOrigin({url:'https://clytszmnrssgvnlwfbrm.supabase.co',key:'synthetic'}),'https://ct-alt.vercel.app');
 for(const path of [null,'https://evil.example','//evil.example','/\\evil.example','/%2f%2fevil.example','/agents?next=https://evil.example','/agents\r\nLocation: https://evil.example','/login'])assert.equal(safeAuthDestination(path),'/agents');
});
test('malformed, duplicate and provider-error callback codes are rejected',()=>{
 for(const query of ['','code=short','code=a'.padEnd(22,'a')+'&code=b'.padEnd(22,'b'),'code=aaaaaaaaaaaaaaaa&error=access_denied','code=%0Aevil','code='+ 'a'.repeat(2049)])assert.equal(callbackCode(new URLSearchParams(query)),null);
 assert.equal(callbackCode(new URLSearchParams('code=12345678-1234-1234-1234-123456789abc')),'12345678-1234-1234-1234-123456789abc');
});

test('callback validates fixed external host behind Next internal URL and HTTPS proxy',()=>{
 const local={url:'http://127.0.0.1:54821',key:'synthetic'},hosted={url:'https://clytszmnrssgvnlwfbrm.supabase.co',key:'synthetic'};
 assert.equal(validCallbackOrigin(new Request('http://localhost:5180/auth/callback',{headers:{host:'127.0.0.1:5180'}}),local),true);
 assert.equal(validCallbackOrigin(new Request('http://localhost/auth/callback',{headers:{host:'ct-alt.vercel.app','x-forwarded-proto':'https'}}),hosted),true);
 for(const headers of [{host:'foreign.example','x-forwarded-proto':'https'},{host:'ct-alt-preview.vercel.app','x-forwarded-proto':'https'},{host:'ct-alt.vercel.app'},{'x-forwarded-host':'ct-alt.vercel.app','x-forwarded-proto':'https'}])assert.equal(validCallbackOrigin(new Request('http://localhost/auth/callback',{headers}),hosted),false);
});
