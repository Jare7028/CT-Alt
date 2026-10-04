import {startDatabaseStorage,registerDatabaseFixture} from './database-storage-bootstrap.mjs';
let storageFixture;
import {runFormsRaces} from '../tests/database/forms-races.mjs';
import{spawnSync}from'node:child_process';import{readFileSync,readdirSync}from'node:fs';import{randomUUID}from'node:crypto';
const name='ct-alt-forms-'+randomUUID(),label=String(process.pid),image='postgres:17-alpine@sha256:b0f9560a2de083e2cc7382e75f808c7381a32852a7ec49117deedb300e552b24';let started=false;
function docker(args,input,allow=false){const r=spawnSync('docker',args,{input,encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});if(!allow&&(r.error||r.status!==0))throw Error(r.error?.message||r.stderr);return r;}
const query=s=>docker(['exec','-i',name,'psql','-X','-At','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],s).stdout.trim();const sql=s=>docker(['exec','-i',name,'psql','-X','-q','-v','ON_ERROR_STOP=1','-U','postgres','-d','ct_alt_test'],s).stderr;
function cleanup(){if(!started)return;try{storageFixture?.cleanup();}finally{const r=docker(['inspect',name],undefined,true);if(r.status===0){if(JSON.parse(r.stdout)[0].Config.Labels?.['ct-alt.test-runner-pid']!==label)throw Error('Forms fixture ownership mismatch');docker(['rm','-f',name]);}started=false;}}
for(const[signal,code]of[['SIGINT',130],['SIGTERM',143]])process.once(signal,()=>{try{cleanup();process.exit(code);}catch{console.error('Owned Forms cleanup needs inspection');process.exit(1);}});
try{docker(['run','-d','--name',name,'--label','ct-alt.test-runner-pid='+label,'--network','none','--tmpfs','/var/lib/postgresql/data','-e','POSTGRES_HOST_AUTH_METHOD=trust','-e','POSTGRES_DB=ct_alt_test',image]);started=true;registerDatabaseFixture(name);let ready=false;for(let i=0;i<100;i++){if(docker(['exec',name,'pg_isready','-h','127.0.0.1','-U','postgres','-d','ct_alt_test'],undefined,true).status===0){ready=true;break;}await new Promise(r=>setTimeout(r,100));}if(!ready)throw Error('Owned Forms database unavailable');
 sql(readFileSync(new URL('../tests/database/bootstrap.sql',import.meta.url),'utf8'));storageFixture = await startDatabaseStorage(name);sql('alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;');const dir=new URL('../supabase/migrations/',import.meta.url),files=readdirSync(dir).filter(f=>f.endsWith('.sql')).sort(),candidate=files.find(f=>f.endsWith('_desktop_forms.sql'));if(!candidate)throw Error('Forms candidate missing');for(const f of files.filter(f=>f<candidate))sql(readFileSync(new URL(f,dir),'utf8'));
 sql(readFileSync(new URL('../tests/database/updates-export-fixture.sql',import.meta.url),'utf8'));sql(readFileSync(new URL('../tests/database/knowledge-base-fixture.sql',import.meta.url),'utf8'));sql(readFileSync(new URL('../tests/database/forms-fixture.sql',import.meta.url),'utf8'));
 const definition="select jsonb_agg(jsonb_build_object('oid',p.oid,'definition',pg_get_functiondef(p.oid),'source',p.prosrc,'owner',p.proowner,'acl',p.proacl,'config',p.proconfig)order by p.oid)from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workforce_private','chat_private')",before=JSON.parse(query(definition)),ids=new Set(before.map(f=>f.oid)),tables=query("select schemaname||'.'||tablename from pg_tables where schemaname in('public','workforce_private','chat_private')order by 1").split('\n'),digest=()=>tables.map(t=>[t,query(`select count(*)||':'||md5(coalesce(string_agg(to_jsonb(t)::text,'|'order by to_jsonb(t)::text),''))from ${t} t`)]),dataBefore=JSON.stringify(digest());
 const permissionsQuery="select jsonb_agg(jsonb_build_object('oid',c.oid,'owner',c.relowner,'acl',c.relacl,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,'columnAcls',(select coalesce(jsonb_agg(jsonb_build_array(a.attnum,a.attacl)order by a.attnum),'[]')from pg_attribute a where a.attrelid=c.oid and a.attnum>0 and not a.attisdropped),'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'command',p.polcmd,'permissive',p.polpermissive,'roles',p.polroles,'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid))order by p.polname),'[]')from pg_policy p where p.polrelid=c.oid))order by c.oid)from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','workforce_private','chat_private')and c.relkind in('r','p')",permissionsBefore=JSON.parse(query(permissionsQuery)),permissionIds=new Set(permissionsBefore.map(t=>t.oid));
 sql(readFileSync(new URL(candidate,dir),'utf8'));
 // Check the Forms upgrade immediately, before unrelated later migrations.
 if(JSON.stringify(before)!==JSON.stringify(JSON.parse(query(definition)).filter(f=>ids.has(f.oid)))||dataBefore!==JSON.stringify(digest()))throw Error('Forms upgrade changed populated baseline data or function metadata');
 if(JSON.stringify(permissionsBefore)!==JSON.stringify(JSON.parse(query(permissionsQuery)).filter(t=>permissionIds.has(t.oid))))throw Error('Forms upgrade changed baseline table owners ACL column grants RLS or policies');
 const rendererOid=query("select 'workforce_private.knowledge_node_json(public.knowledge_nodes)'::regprocedure::oid");
 for(const f of files.filter(f=>f>candidate)){
  const priorFunctions=JSON.parse(query(definition)),priorPermissions=JSON.parse(query(permissionsQuery)),priorPermissionIds=new Set(priorPermissions.map(t=>t.oid)),migrationSQL=readFileSync(new URL(f,dir),'utf8');
  sql(migrationSQL);
  const afterFunctions=JSON.parse(query(definition));
  const fileRenderer=f.endsWith('_knowledge_base_files.sql');
  const start=fileRenderer?migrationSQL.indexOf('create or replace function workforce_private.knowledge_node_json(n public.knowledge_nodes)'):-1;
  const body=start>=0?migrationSQL.slice(start).match(/as\s*\$\$([\s\S]*?)\$\$;/):null;
  if(fileRenderer&&(start<0||!body))throw Error('Files migration lacks the reviewed renderer definition');
  for(const prior of priorFunctions){
   const after=afterFunctions.find(row=>row.oid===prior.oid);
   if(!after)throw Error('Follow-on migration removed retained Forms function identity');
   if(fileRenderer&&String(prior.oid)===rendererOid){
    // Exact source and normalized definition replacement: no blind exclusion of
    // the renderer, and no changes to signature, owner, grants or attributes.
    if(after.source!==body[1]||!prior.source||!prior.definition.includes(prior.source))throw Error('File renderer body does not match reviewed migration source');
    const expected={...prior,source:body[1],definition:prior.definition.replace(prior.source,body[1])};
    if(JSON.stringify(expected)!==JSON.stringify(after))throw Error('Files changed renderer identity owner ACL config or non-body definition');
   }else if(JSON.stringify(prior)!==JSON.stringify(after))throw Error('Follow-on migration '+f+' changed retained Forms function '+prior.oid+' metadata unexpectedly');
  }
  if(dataBefore!==JSON.stringify(digest())||JSON.stringify(priorPermissions)!==JSON.stringify(JSON.parse(query(permissionsQuery)).filter(t=>priorPermissionIds.has(t.oid))))throw Error('Follow-on migration changed retained Forms data or table permissions');
 }
 // Freeze the complete final function and permission state before the suites.
 // Assertions/races must preserve the reviewed renderer and every new function.
 const finalFunctions=query(definition),finalPermissions=query(permissionsQuery);
 const checks=sql(readFileSync(new URL('../tests/database/forms.sql',import.meta.url),'utf8')).split('\n').filter(x=>x.includes('PASS:')).map(x=>x.slice(x.indexOf('PASS:')));checks.push(...sql(readFileSync(new URL('../tests/database/forms-boundaries.sql',import.meta.url),'utf8')).split('\n').filter(x=>x.includes('PASS:')).map(x=>x.slice(x.indexOf('PASS:'))));checks.push(...sql(readFileSync(new URL('../tests/database/forms-history.sql',import.meta.url),'utf8')).split('\n').filter(x=>x.includes('PASS:')).map(x=>x.slice(x.indexOf('PASS:'))));checks.push(...await runFormsRaces({name,query,sql}));if(finalFunctions!==query(definition)||dataBefore!==JSON.stringify(digest()))throw Error('Forms assertions changed populated baseline data or final function metadata');if(finalPermissions!==query(permissionsQuery))throw Error('Forms assertions changed final table owners ACL column grants RLS or policies');checks.push('PASS: all baseline table owner grants column ACL RLS and complete policy definitions retained');checks.push('PASS: Forms upgrade preserves populated baseline and all final functions retain exact reviewed definitions owners ACL config');console.log(checks.join('\n'));console.log(`${checks.length} Forms assertions passed.`);
}catch(e){console.error(e.message);process.exitCode=1;}finally{try{cleanup();}catch{console.error('Owned Forms cleanup needs inspection');process.exitCode=1;}}
