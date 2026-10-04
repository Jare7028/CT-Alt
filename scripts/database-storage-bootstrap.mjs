import {randomBytes,createHmac} from 'node:crypto';
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {startOwnedStorage} from './storage-provider-fixture.mjs';

const pending=new Map();
export function registerDatabaseFixture(name){if(!/^ct-alt-[a-z0-9-]+$/.test(name))throw Error('Unverified owned PostgreSQL identity.');pending.set(name,{cleanup:null});}
for(const [signal,code] of [['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{
  let failed=false;
  for(const [name,entry] of pending){
    try{entry.cleanup?.();}catch{failed=true;console.error('Owned Storage fixture cleanup requires inspection.');}
    const inspected=spawnSync('docker',['inspect',name],{encoding:'utf8',timeout:10000});
    if(inspected.status===0){
      try{const info=JSON.parse(inspected.stdout)[0];if(info.Config.Labels?.['ct-alt.test-runner-pid']!==String(process.pid))throw Error('Ownership mismatch');
        const removed=spawnSync('docker',['rm','-f',name],{encoding:'utf8',timeout:30000});if(removed.status!==0)throw Error('Removal failed');
      }catch{failed=true;console.error('Owned PostgreSQL fixture cleanup requires inspection.');}
    }
  }
  process.exit(failed?1:code);
});

/** Genuine provider bootstrap for offline SQL suites; no remote URLs or host ports. */
export async function startDatabaseStorage(dbContainer,dbName='ct_alt_test') {
  const files=readdirSync(new URL('../supabase/migrations/',import.meta.url));
  if(!files.some(file=>file.endsWith('_knowledge_base_files.sql')))return null;
  if(!/^ct-alt-[a-z0-9-]+$/.test(dbContainer)||dbName!=='ct_alt_test')throw Error('Unverified isolated Storage database binding.');
  const jwtSecret=randomBytes(48).toString('hex');
  const now=Math.floor(Date.now()/1000);
  const jwt=role=>{
    const header=Buffer.from(JSON.stringify({alg:'HS256',typ:'JWT'})).toString('base64url');
    const payload=Buffer.from(JSON.stringify({iss:'supabase',role,iat:now,exp:now+3600})).toString('base64url');
    const input=header+'.'+payload;
    return input+'.'+createHmac('sha256',jwtSecret).update(input).digest('base64url');
  };
  const entry=pending.get(dbContainer)??{cleanup:null};pending.set(dbContainer,entry);
  let fixture;
  try{fixture=await startOwnedStorage({dbContainer,dbName,fixtureLabel:{key:'ct-alt.test-runner-pid',value:String(process.pid)},jwtSecret,anonKey:jwt('anon'),serviceKey:jwt('service_role'),onCleanupReady:cleanup=>{entry.cleanup=cleanup;}});}catch(error){pending.delete(dbContainer);throw error;}
  const cleanup=fixture.cleanup;fixture.cleanup=()=>{cleanup();pending.delete(dbContainer);};
  console.log('Genuine pinned Supabase Storage bootstrap completed for isolated SQL checks.');
  return fixture;
}
