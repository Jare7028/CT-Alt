import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

// Explicitly local: no supplied URL, remote link, key or tenant is accepted.
if (!readFileSync('supabase/config.toml','utf8').includes('project_id = "ct-alt-independent"')) throw new Error('Independent local project identity mismatch');
const status = spawnSync(process.env.CT_ALT_SUPABASE_CLI || 'supabase',['status','--workdir',process.cwd(),'-o','json'],{encoding:'utf8',env:{...process.env,SUPABASE_HOME:'/tmp/ct-alt-supabase-cli'},timeout:15000});
if(status.status!==0)throw new Error('CT Alt local Supabase must be running');
const settings=JSON.parse(status.stdout);
const url=settings.API_URL;
if(url!=='http://127.0.0.1:54821')throw new Error('Only the independent loopback API is permitted');
const health=await fetch(url+'/auth/v1/health',{headers:{apikey:settings.ANON_KEY}});
if(!health.ok)throw new Error('Local Auth health check failed');
const admin=createClient(url,settings.SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const tenantA='40000000-0000-4000-8000-000000000001';
const tenantB='40000000-0000-4000-8000-000000000002';
// Remove only the two obsolete local synthetic IDs used by the initial test setup.
for (const table of ['agent_audit','agents','agent_fields','tenant_memberships']) {
 const result=await admin.from(table).delete().in('tenant_id',['40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002']);
 if(result.error)throw new Error('Obsolete local fixture cleanup failed');
}
await admin.from('tenants').delete().in('id',['40000000-0000-0000-0000-000000000001','40000000-0000-0000-0000-000000000002']);
const password=randomBytes(24).toString('base64url');
const accounts={};
for(const [name,role] of [['owner','owner'],['admin','admin'],['manager','manager'],['employee','employee'],['foreign','owner']]){
 const email=`ct-alt-${name}@example.test`;
 const list=await admin.auth.admin.listUsers({perPage:1000});
 if(list.error)throw new Error('Local fixture account lookup failed');
 const existing=list.data.users.find(user=>user.email===email);
 const result=existing ? await admin.auth.admin.updateUserById(existing.id,{password,email_confirm:true}) : await admin.auth.admin.createUser({email,password,email_confirm:true});
 if(result.error)throw new Error('Local fixture account creation failed');
 accounts[name]={id:result.data.user.id,email,password,role};
}
for(const [table,data] of [
 ['tenants',[{id:tenantA,name:'Synthetic North Company',time_zone:'Europe/London'},{id:tenantB,name:'Synthetic South Company',time_zone:'America/New_York'}]],
 ['tenant_memberships',Object.entries(accounts).map(([name,account])=>({tenant_id:name==='foreign'?tenantB:tenantA,user_id:account.id,display_name:'Synthetic '+name,role:account.role,status:'active'}))],
 ['agent_fields',[{tenant_id:tenantA,key:'client',label:'Client',required:true,position:1}]],
]){
 const result=await admin.from(table).upsert(data);if(result.error)throw new Error('Local fixture table creation failed: '+table);
}
for(const [name,account] of Object.entries(accounts)){
 const result=await admin.from('agents').upsert({tenant_id:name==='foreign'?tenantB:tenantA,user_id:account.id,first_name:name==='foreign'?'Foreign':'Synthetic',last_name:name,phone:'+447700900'+({owner:201,admin:202,manager:203,employee:204,foreign:205}[name]),title:'Synthetic '+name,team:name==='foreign'?'South':'North',custom_fields:name==='foreign'?{}:{client:'Demo client'},created_by:name==='foreign'?account.id:accounts.owner.id},{onConflict:'tenant_id,phone'});
 if(result.error)throw new Error('Local agent fixtures failed');
}
writeFileSync('.env.local',`NEXT_PUBLIC_SUPABASE_URL=${url}\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${settings.ANON_KEY}\n`,{mode:0o600});
writeFileSync('/tmp/ct-alt-local-fixtures.json',JSON.stringify({url,key:settings.ANON_KEY,tenantA,tenantB,accounts}),{mode:0o600});
console.log('Synthetic local accounts and two companies ready. App env contains only loopback URL and public key.');
