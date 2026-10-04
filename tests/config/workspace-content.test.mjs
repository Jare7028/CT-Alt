import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildSql, companyId, prepareContent } from '../../scripts/prepare-workspace-content.mjs';

const uuid = n => `10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function fixture() {
  const counts = {agents:21,schedules:3,jobs:6,shifts:60,clock_jobs:6,tasks:12,requests:48,updates:6,knowledge:2,nodes:6,forms:2};
  let counter = 1;
  const data = Object.fromEntries(Object.entries(counts).map(([key,count]) => [key,Array.from({length:count},(_,i) => ({
    id:uuid(counter++),tenant_id:companyId,revision:({schedules:24,shifts:2,knowledge:4}[key] || 1),
    name:'[DEMO v1] Resource',title:`[DEMO v1] Request ${String(i+1).padStart(2,'0')}`,description:'Artificial seed',body:'Synthetic draft',
    status:key==='requests' ? 'new' : key==='agents' ? 'active' : 'draft',
    first_name:'Demo',last_name:i===20 ? 'Coordinator' : `Staff ${String(i+1).padStart(2,'0')}`,
    team:i<7 ? 'Demo North' : i<14 ? 'Demo Central' : i===20 ? 'Demo coordination' : 'Demo South',user_id:key==='agents' && i===20 ? uuid(999) : null,
    phone:`+447700900${String(i+100).padStart(3,'0')}`,time_zone:'UTC',employment_start_date:'2026-10-04',custom_fields:{},
    start_date:'2026-10-04',due_date:'2026-10-06',priority:'normal',assignee_agent_id:null,assignee_actor_id:null,
    allow_comments:true,allow_reactions:true,require_confirmation:false,allow_respondent_edit:true,
    schema:[{id:uuid(1001),kind:'text',label:'Demo notes',required:true},{id:uuid(1002),kind:'yes_no',label:'Demo check',required:true},{id:uuid(1003),kind:'number',label:'Demo quantity',required:false}],
  }))]));
  data.nodes.forEach((x,i) => {x.base_id=data.knowledge[i<3 ? 0 : 1].id;x.kind=i%3===0 ? 'folder' : 'text';if(x.kind==='folder')x.body=null;});
  data.shifts.forEach((x,i) => {x.job_id=data.jobs[i%6].id;});
  return data;
}

test('rejects foreign-company snapshots, missing rows and duplicate identities', () => {
  const foreign = fixture();foreign.forms[0].tenant_id=uuid(9999);
  assert.throws(() => prepareContent(foreign),/company/);
  const missing = fixture();missing.agents.pop();assert.throws(() => prepareContent(missing),/count/);
  const duplicate = fixture();duplicate.requests[1].id=duplicate.requests[0].id;assert.throws(() => prepareContent(duplicate),/identity/);
});
test('rejects previously edited records rather than resetting them', () => {
  for (const key of ['agents','schedules','shifts','clock_jobs','tasks','requests','updates','knowledge','nodes','forms']) {
    const data=fixture();data[key][0].revision++;assert.throws(() => prepareContent(data),/edited/);
  }
});
test('replaces placeholder content while retaining identities, dates and access', () => {
  const before=fixture();const unchanged=structuredClone(before);const after=prepareContent(before);
  assert.deepEqual(before,unchanged);
  assert.equal(new Set(after.agents.map(x => `${x.first_name} ${x.last_name}`)).size,21);
  assert.equal(new Set(after.requests.map(x => x.title)).size,48);
  for (const key of Object.keys(before)) for (let i=0;i<before[key].length;i++) {
    for (const field of ['id','tenant_id','user_id','phone','start_date','due_date','status','priority','assignee_agent_id','assignee_actor_id']) assert.deepEqual(after[key][i][field],before[key][i][field]);
  }
  for (const person of after.agents) assert.doesNotMatch(person.first_name+person.last_name+person.title+person.team,/demo/i);
  const visibleFields={tasks:['title','description'],requests:['title','description'],updates:['title','body'],knowledge:['name','description'],nodes:['name','description','body'],forms:['name','description']};
  for (const [key,fields] of Object.entries(visibleFields)) for (const x of after[key]) for (const field of fields) if(x[field])assert.doesNotMatch(x[field],/demo|artificial|synthetic/i);
});
test('SQL proposal defaults to rollback, uses full CAS and checks untouched and empty tables', () => {
  const before=fixture();const after=prepareContent(before);const sql=buildSql(before,after);
  assert.match(sql,/^begin;/);assert.match(sql,/rollback;\n$/);assert.doesNotMatch(sql,/\ncommit;/);
  assert.match(sql,/current_row is distinct from/);
  assert.match(sql,/where value=original/);
  assert.match(sql,/ct_content_tables/);
  assert.match(sql,/Unexpected row count/);
  assert.doesNotMatch(sql,/update auth\.|insert into auth\.|delete from auth\.|alter table|create function/i);
  assert.equal(buildSql(before,after,{commit:true}),sql.replace(/rollback;\n$/,'commit;\n'));
});
