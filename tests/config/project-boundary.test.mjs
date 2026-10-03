import test from 'node:test';
import assert from 'node:assert/strict';
import { approvedSupabaseUrl } from '../../lib/supabase-config.ts';

test('only CT Alt project and isolated local API are permitted',()=>{
 assert.equal(approvedSupabaseUrl('https://clytszmnrssgvnlwfbrm.supabase.co'),true);
 assert.equal(approvedSupabaseUrl('http://127.0.0.1:54821'),true);
 for(const url of [undefined,'https://another-project.supabase.co','http://127.0.0.1:54321','https://clytszmnrssgvnlwfbrm.supabase.co.attacker.example','https://example.com','']) assert.equal(approvedSupabaseUrl(url),false);
});
