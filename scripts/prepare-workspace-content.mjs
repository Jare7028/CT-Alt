import { readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

// Preparation only: never connects to a service or executes SQL. The input is a
// private snapshot of the original fictional seed, not an arbitrary live export.
export const companyId = '9a221914-d01b-44a1-9eed-c0c432619701';
const names = [
  ['Amelia', 'Bennett'], ['Oliver', 'Hughes'], ['Sofia', 'Patel'],
  ['Noah', 'Williams'], ['Isla', 'Thompson'], ['Ethan', 'Clarke'],
  ['Maya', 'Roberts'], ['Leo', 'Anderson'], ['Grace', 'Wilson'],
  ['Arjun', 'Shah'], ['Chloe', 'Davies'], ['Daniel', 'Evans'],
  ['Zara', 'Ahmed'], ['Finn', 'Murphy'], ['Ella', 'Brooks'],
  ['Lucas', 'Reed'], ['Priya', 'Nair'], ['James', 'Walker'],
  ['Freya', 'Lewis'], ['Adam', 'Khan'],
];
const taskDescriptions = [
  'Prepare the 09:00 briefing: confirm site coverage, highlight outstanding requests and share the priorities for each team.',
  'Count gloves, cleaning materials and stationery. Record low stock and add any replenishment needs to Requests.',
  'Review next week’s North, Central and South coverage. Flag gaps and confirm handover arrangements before Friday.',
  'Check clear walkways, emergency exits and equipment condition. Record any issue and escalate urgent hazards to the coordinator.',
  'Summarise completed work, outstanding follow-ups and equipment issues so the next shift can pick up without delay.',
  'Inspect shared equipment before the next shift. Set aside damaged items and record the repair or replacement needed.',
  'Prepare the weekly team meeting agenda: service coverage, supply levels, safety observations and upcoming training.',
  'Check the morning and afternoon coverage at all three sites. Raise any uncovered reception or support periods.',
  'Review the welcome pack and check that new starters can find their rota, daily check form and operations handbook.',
  'Return shared equipment to its marked storage area, clear the desk and check that handover materials are ready.',
  'Read the opening and closing guide in the Operations handbook and note any questions for the next team briefing.',
  'Prepare next week’s priorities, review open work requests and confirm the stock and equipment required at each site.',
];
const updateCopy = [
  ['Welcome to CT Alt', 'Welcome to the team. Use Job scheduling to check your upcoming shifts, Quick Tasks to review priorities and Requests to flag work that needs attention. The Operations handbook covers opening, closing and handover routines. Before your first shift, review the Getting started guide and confirm any questions with your coordinator.'],
  ['Weekly operations briefing', 'This week’s priorities are consistent reception coverage, timely stock replenishment and clear shift handovers. Review your rota before Monday’s briefing. Add equipment and facilities issues to Requests with a clear location, urgency and suggested next step. Check the board before raising a duplicate.'],
  ['Safety reminders for every shift', 'Keep walkways and emergency exits clear. Check shared equipment before use and set aside damaged items. Record hazards in the Equipment inspection form and raise urgent repairs with the coordinator immediately. Include unresolved issues in your handover notes.'],
  ['Team meeting: coverage and handovers', 'The next team meeting will cover next week’s service coverage, open facilities requests, supply levels and handover improvements. Bring one practical suggestion and any question about your upcoming shifts. Review the Requests board beforehand so we can agree clear next steps.'],
  ['Learning resources for new starters', 'The Getting started guide explains where to find your rota, how to record time and how to complete the daily shift check. The Operations handbook contains opening, closing and handover guidance. Review both resources before your first independent shift and discuss any questions with your coordinator.'],
  ['A clearer service handover', 'At the end of each shift, record completed work, outstanding requests, equipment issues and the next action needed. Include a location and avoid unnecessary personal information. Check that urgent issues have an owner before leaving and make sure the next team can find your notes.'],
];
const requestActions = [
  ['Replace entrance sign', 'Check the sign dimensions and wording, arrange a replacement and confirm the entrance is clearly marked.'],
  ['Check stock room lighting', 'Inspect the reported lighting issue, record which fitting needs attention and arrange a repair if required.'],
  ['Order protective gloves', 'Check current glove stock and sizes, confirm the quantity required and arrange replenishment before stock runs low.'],
  ['Review opening checklist', 'Walk through the opening routine with the site lead and update any unclear or missing checklist steps.'],
  ['Arrange equipment service', 'Check the equipment service schedule, agree a suitable maintenance slot and confirm cover during the visit.'],
  ['Restock cleaning supplies', 'Count the cleaning materials on hand, record shortages and replenish the site’s agreed essentials.'],
  ['Confirm delivery access', 'Confirm the delivery entrance, available access hours and who will receive the next scheduled delivery.'],
  ['Update handover notes', 'Review the latest shift handover and record outstanding work, the next action and the person coordinating follow-up.'],
];
const locations = ['North reception', 'Central service desk', 'South support hub', 'North stores', 'Central workroom', 'South reception'];
const guideBodies = [
  ['Opening and closing', 'Opening and closing checklist', 'Opening\nCheck that entrances, reception and walkways are ready. Inspect shared equipment before use, review today’s rota and read the previous shift’s handover. Confirm that essential supplies are available.\n\nDuring the shift\nKeep work areas clear and record facilities or equipment issues in Requests. Raise urgent safety concerns with the coordinator.\n\nClosing\nReturn equipment to its storage area, check the work area and record outstanding actions for the next shift. Follow the site’s agreed closing and access routine.'],
  ['Shift handovers', 'Writing a useful handover', 'A good handover lets the next team act without repeating checks. Record what was completed, what remains outstanding, the location and the next action. Include the relevant Requests card where one exists.\n\nReview urgent items with the coordinator before leaving. Keep notes factual and concise, avoid unnecessary personal information and make sure shared equipment is ready for the next shift.'],
  ['Your first shift', 'Before your first shift', 'Review your upcoming shift in Job scheduling and check the site, start time and assigned work. Read the previous handover and introduce yourself to the site lead.\n\nUse Time Clock to record the start and end of your shift and any breaks. Review Quick Tasks for your priorities. Complete the Daily shift check before handing over. If something is unclear, ask your coordinator before proceeding.'],
  ['Where to find things', 'Finding your way around CT Alt', 'Job scheduling: upcoming shifts and site coverage.\nTime Clock: record working time and breaks.\nQuick Tasks: practical actions and completion tracking.\nRequests: facilities, supplies and other work that needs follow-up.\nUpdates: team briefings and announcements.\nKnowledge Base: opening, closing and handover guidance.\nForms: daily shift checks and equipment inspections.\n\nKeep information current and use a clear location when raising a request.'],
];
const sqlJson = v => "'" + JSON.stringify(v).replaceAll("'", "''") + "'::jsonb";
const sqlText = v => "'" + v.replaceAll("'", "''") + "'";

export function prepareContent(data) {
  const counts = { agents: 21, schedules: 3, jobs: 6, shifts: 60, clock_jobs: 6, tasks: 12, requests: 48, updates: 6, knowledge: 2, nodes: 6, forms: 2 };
  for (const [key, count] of Object.entries(counts)) {
    if (!Array.isArray(data[key]) || data[key].length !== count) throw Error(`Unexpected ${key} seed count`);
    if (new Set(data[key].map(x => x.id)).size !== count || data[key].some(x => x.tenant_id !== companyId)) throw Error(`Invalid ${key} identity or company`);
    if (data[key].some(x => !/^[0-9a-f-]{36}$/.test(x.id))) throw Error('Invalid UUID');
  }
  const revisions = { schedules: 24, shifts: 2, clock_jobs: 1, tasks: 1, updates: 1, knowledge: 4, nodes: 1, forms: 1 };
  for (const [key, revision] of Object.entries(revisions)) if (data[key].some(x => x.revision !== revision)) throw Error(`${key} seed was edited`);
  if (data.requests.some(x => x.revision !== (x.status === 'new' ? 1 : 2))) throw Error('Requests seed was edited');
  if (data.agents.some(x => x.first_name !== 'Demo' || x.revision !== 1 || x.status !== 'active') || data.agents.filter(x => x.user_id).length !== 1) throw Error('Directory seed was edited');
  const result = structuredClone(data);
  for (const agent of result.agents) {
    const index = Number(agent.last_name.match(/^Staff (\d{2})$/)?.[1]);
    if (agent.last_name === 'Coordinator') {
      [agent.first_name, agent.last_name] = ['Alex', 'Morgan'];
      agent.title = 'Operations coordinator'; agent.team = 'Operations';
    } else {
      if (!index || index > 20) throw Error('Unknown fictional staff record');
      [agent.first_name, agent.last_name] = names[index - 1];
      agent.team = agent.team.replace('Demo ', '') + (index <= 7 ? ' Operations' : index <= 14 ? ' Services' : ' Support');
      agent.title = index === 1 || index === 8 || index === 15 ? 'Team leader' : index % 3 === 0 ? 'Service specialist' : 'Operations associate';
    }
  }
  const replacePrefix = value => value.replace(/^\[DEMO v1\] /, '');
  for (const key of ['schedules', 'jobs', 'clock_jobs']) for (const x of result[key]) x.name = replacePrefix(x.name);
  for (const shift of result.shifts) shift.title = result.jobs.find(x => x.id === shift.job_id)?.name || 'Service coverage';
  result.tasks.forEach((x, i) => { x.title = replacePrefix(x.title).replace('Read the demo policy', 'Read the opening and closing guide'); x.description = taskDescriptions[i]; });
  result.updates.forEach((x, i) => { [x.title, x.body] = updateCopy[i]; });
  result.requests.forEach(x => {
    const sequence = Number(x.title.match(/ (\d{2})$/)?.[1]);
    if (!sequence || sequence > 48) throw Error('Unknown request seed');
    const [title, description] = requestActions[(sequence - 1) % 8];
    const location = locations[Math.floor((sequence - 1) / 8)];
    x.title = `${title} — ${location}`; x.description = `${location}: ${description}`;
  });
  result.knowledge.forEach(x => { x.name = replacePrefix(x.name); x.description = x.name === 'Operations handbook' ? 'Practical guidance for opening, closing, safe working and clear shift handovers.' : 'A guide to your first shift and the tools used by the team.'; });
  let textIndex = 0;
  result.nodes.forEach(x => {
    if (x.kind === 'folder') { x.name = x.base_id === result.knowledge[0].id ? 'Working routines' : 'Welcome to the team'; x.description = 'Essential guidance for everyday work.'; }
    else { const [name, description, body] = guideBodies[textIndex++]; x.name = name; x.description = description; x.body = body; }
  });
  result.forms.forEach((x, i) => {
    x.name = i === 0 ? 'Daily shift check' : 'Equipment inspection';
    x.description = i === 0 ? 'Record shift completion, handover notes and any outstanding follow-ups.' : 'Record equipment condition and flag items needing repair or replacement.';
    const labels = i === 0 ? ['Shift handover notes', 'All scheduled work completed?', 'Outstanding follow-ups'] : ['Equipment inspected and observations', 'Equipment safe to use?', 'Items requiring attention'];
    x.schema.forEach((field, j) => { field.label = labels[j]; });
  });
  for (const key of ['schedules', 'jobs', 'shifts', 'clock_jobs', 'tasks', 'requests', 'updates', 'knowledge', 'nodes', 'forms']) {
    if (data[key].some(x => !/demo|artificial|synthetic/i.test(JSON.stringify(x)))) throw Error(`Unexpected ${key} seed content`);
  }
  return result;
}

export function buildSql(before, after, { commit = false } = {}) {
  const tables = { agents: 'agents', schedules: 'rota_schedules', jobs: 'rota_jobs', shifts: 'rota_shifts', clock_jobs: 'time_clock_jobs', tasks: 'quick_tasks', requests: 'work_requests', updates: 'updates_posts', knowledge: 'knowledge_bases', nodes: 'knowledge_nodes', forms: 'forms' };
  const fields = { agents: ['first_name','last_name','title','team','revision','updated_at'], schedules: ['name','revision'], jobs: ['name'], shifts: ['title','revision'], clock_jobs: ['name','revision'], tasks: ['title','description','revision'], requests: ['title','description','assignee_name','revision','updated_at'], updates: ['title','body','revision','status','content_revision','published_at'], knowledge: ['name','description','revision','status'], nodes: ['name','description','body','revision'], forms: ['name','description','schema','revision','updated_at','status','schema_frozen'] };
  const lines = [
    'begin;', "set local lock_timeout = '5s';", "set local statement_timeout = '60s';",
    'create temporary table ct_content_before (tbl text, row_data jsonb) on commit drop;',
    'create temporary table ct_content_tables (tbl text, original_count bigint) on commit drop;',
    'create temporary table ct_content_allowed (tbl text, id uuid, fields text[]) on commit drop;',
    "create temporary table ct_content_meta on commit drop as select (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workforce_private','auth')) as procs, (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','workforce_private','auth')) as relations, (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p) as policies, (select jsonb_agg(to_jsonb(t) order by t.oid) from pg_trigger t) as triggers;",
    `do $ct_content$ declare t constant uuid := '${companyId}'; actor uuid; obj jsonb; current_row jsonb; rec record; original jsonb; now_rows jsonb; changed_fields text[]; begin`,
    "if (select count(*) from public.tenants) <> 1 or not exists(select 1 from public.tenants where id=t and name='CT Alt' and status='active') then raise exception 'CT Alt company mismatch'; end if;",
    "if (select count(*) from supabase_migrations.schema_migrations) <> 20 or not exists(select 1 from supabase_migrations.schema_migrations where version='20261004114249') then raise exception 'Unexpected migration history'; end if;",
    "select m.user_id into strict actor from public.tenant_memberships m join auth.users u on u.id=m.user_id where m.tenant_id=t and m.role='owner' and m.status='active' and u.email_confirmed_at is not null and u.is_anonymous is not true;",
    `if not exists(select 1 from public.agents where id='${before.agents.find(x => x.user_id).id}' and tenant_id=t and user_id=actor) then raise exception 'Owner linkage mismatch'; end if;`,
    "perform set_config('request.jwt.claim.sub',actor::text,true); perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);",
    "for rec in select n.nspname,c.relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in('public','workforce_private','auth','supabase_migrations') order by c.oid loop if rec.nspname in('public','workforce_private') then execute format('lock table %I.%I in share row exclusive mode',rec.nspname,rec.relname); end if; execute format('insert into ct_content_before select %L,to_jsonb(x) from %I.%I x',rec.nspname||'.'||rec.relname,rec.nspname,rec.relname); insert into ct_content_tables select rec.nspname||'.'||rec.relname,count(*) from ct_content_before where tbl=rec.nspname||'.'||rec.relname; end loop;",
  ];
  for (const [key, table] of Object.entries(tables)) {
    for (let i = 0; i < before[key].length; i++) {
      const old = before[key][i]; const next = after[key][i];
      lines.push(`select to_jsonb(x) into current_row from public.${table} x where id='${old.id}' and tenant_id=t; if current_row is distinct from ${sqlJson(old)} then raise exception 'Seed changed: ${table} ${old.id}'; end if;`);
      lines.push(`insert into ct_content_allowed values ('public.${table}','${old.id}',array[${fields[key].map(sqlText).join(',')}]);`);
      if (key === 'agents') lines.push(`perform public.save_agents(t,jsonb_build_array(${sqlJson({action:'update',id:old.id,revision:old.revision,first_name:next.first_name,last_name:next.last_name,phone:old.phone,title:next.title,team:next.team,employment_start_date:old.employment_start_date,custom_fields:old.custom_fields})}));`);
      if (key === 'schedules') lines.push(`perform public.save_rota(t,jsonb_build_object('action','update_schedule','schedule_id','${old.id}','revision',${old.revision},'name',${sqlText(next.name)},'time_zone',${sqlText(old.time_zone)},'agent_ids',(select jsonb_agg(agent_id) from public.rota_agents where tenant_id=t and schedule_id='${old.id}'),'admin_ids',(select coalesce(jsonb_agg(user_id),'[]'::jsonb) from public.rota_admins where tenant_id=t and schedule_id='${old.id}')));`);
      if (key === 'jobs' || key === 'clock_jobs') lines.push(`update public.${table} set name=${sqlText(next.name)}${key === 'clock_jobs' ? ',revision=revision+1' : ''} where id='${old.id}' and tenant_id=t;`);
      if (key === 'shifts') lines.push(`update public.rota_shifts set title=${sqlText(next.title)},revision=revision+1 where id='${old.id}' and tenant_id=t;`);
      if (key === 'tasks') lines.push(`perform public.save_quick_task(t,gen_random_uuid(),jsonb_build_object('action','edit','taskId','${old.id}','revision',${old.revision},'title',${sqlText(next.title)},'description',${sqlText(next.description)},'agentIds',(select jsonb_agg(agent_id) from public.quick_task_assignees where tenant_id=t and task_id='${old.id}'),'startDate',${sqlJson(old.start_date)},'dueDate',${sqlJson(old.due_date)}));`);
      if (key === 'requests') lines.push(`perform public.save_request(t,gen_random_uuid(),${sqlJson({action:'edit',requestId:old.id,revision:old.revision,title:next.title,description:next.description,priority:old.priority,dueDate:old.due_date,assigneeAgentId:old.assignee_agent_id,assigneeActorId:old.assignee_actor_id})}::text);`);
      if (key === 'updates') {
        lines.push(`perform public.save_update(t,gen_random_uuid(),jsonb_build_object('action','edit','postId','${old.id}','revision',${old.revision},'title',${sqlText(next.title)},'body',${sqlText(next.body)},'recipientIds',(select jsonb_agg(actor_id) from public.updates_recipients where tenant_id=t and post_id='${old.id}'),'allowComments',${old.allow_comments},'allowReactions',${old.allow_reactions},'requireConfirmation',${old.require_confirmation}));`);
        if (i < 4) lines.push(`perform public.save_update(t,gen_random_uuid(),jsonb_build_object('action','publish','postId','${old.id}','revision',${old.revision+1}));`);
      }
      if (key === 'knowledge') lines.push(`perform public.save_knowledge_base(t,gen_random_uuid(),${sqlJson({action:'edit_base',baseId:old.id,revision:old.revision,name:next.name,description:next.description})});`);
      if (key === 'nodes') lines.push(`perform public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','edit_node','baseId','${old.base_id}','revision',(select revision from public.knowledge_bases where id='${old.base_id}' and tenant_id=t),'nodeId','${old.id}','nodeRevision',${old.revision},'kind',${sqlText(old.kind)},'name',${sqlText(next.name)},'description',${sqlText(next.description)})${old.kind === 'text' ? `||jsonb_build_object('body',${sqlText(next.body)})` : ''});`);
      if (key === 'forms') {
        lines.push(`perform public.save_form(t,gen_random_uuid(),${sqlJson({action:'edit_form',formId:old.id,formRevision:old.revision,name:next.name,description:next.description,schema:next.schema,allowRespondentEdit:old.allow_respondent_edit})}::text);`);
        lines.push(`perform public.save_form(t,gen_random_uuid(),${sqlJson({action:'publish_form',formId:old.id,formRevision:old.revision+1})}::text);`);
      }
    }
  }
  for (const base of before.knowledge) lines.push(`perform public.save_knowledge_base(t,gen_random_uuid(),jsonb_build_object('action','publish_base','baseId','${base.id}','revision',(select revision from public.knowledge_bases where id='${base.id}' and tenant_id=t)));`);
  lines.push(
    // Every original row must still exist; outside these exact IDs/columns it
    // must be byte-identical. This includes all Auth, membership and history rows.
    `for rec in select * from ct_content_tables loop execute format('select coalesce(jsonb_agg(to_jsonb(x)),''[]''::jsonb) from %s x',rec.tbl) into now_rows;
      if jsonb_array_length(now_rows)<>rec.original_count+(case rec.tbl when 'public.agent_audit' then 21 when 'public.rota_audit' then 3 when 'public.quick_task_audit' then 12 when 'public.work_request_audit' then 48 when 'public.updates_audit' then 10 when 'public.knowledge_audit' then 10 when 'public.form_audit' then 4 when 'workforce_private.quick_task_operations' then 12 when 'workforce_private.request_operations' then 48 when 'workforce_private.updates_operations' then 10 when 'workforce_private.knowledge_operations' then 10 when 'workforce_private.form_operations' then 4 else 0 end) then raise exception 'Unexpected row count in %',rec.tbl; end if;
      for original in select row_data from ct_content_before where tbl=rec.tbl loop
      if rec.tbl='public.quick_task_assignees' and original->>'agent_id'='${before.agents.find(x => x.user_id).id}' and exists(select 1 from ct_content_allowed where tbl='public.quick_tasks' and id::text=original->>'task_id') then
        if not exists(select 1 from jsonb_array_elements(now_rows) where value=(original-'agent_name')||jsonb_build_object('agent_name','Alex Morgan')) then raise exception 'Task assignment changed'; end if;
      else select fields into changed_fields from ct_content_allowed where tbl=rec.tbl and id::text=original->>'id'; if changed_fields is null then if not exists(select 1 from jsonb_array_elements(now_rows) where value=original) then raise exception 'Preserved row changed in %',rec.tbl; end if; else select value into current_row from jsonb_array_elements(now_rows) where value->>'id'=original->>'id'; if current_row is null or (current_row-changed_fields) is distinct from (original-changed_fields) then raise exception 'Unapproved field change in %',rec.tbl; end if; end if; end if;
    end loop; end loop;`,
    "if exists(select 1 from ct_content_meta where procs is distinct from (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in('public','workforce_private','auth')) or relations is distinct from (select jsonb_agg(to_jsonb(c) order by c.oid) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in('public','workforce_private','auth')) or policies is distinct from (select jsonb_agg(to_jsonb(p) order by p.oid) from pg_policy p) or triggers is distinct from (select jsonb_agg(to_jsonb(x) order by x.oid) from pg_trigger x)) then raise exception 'Schema or security metadata changed'; end if;",
    "if exists(select 1 from public.agents where tenant_id=t and (first_name='Demo' or title ilike '%demo%' or team ilike '%demo%')) then raise exception 'Placeholder directory labels remain'; end if;",
    "if (select count(*) from public.work_requests where tenant_id=t)<>48 or (select count(distinct title) from public.work_requests where tenant_id=t)<>48 then raise exception 'Request count or unique titles mismatch'; end if;",
    "if (select count(*) from public.forms where tenant_id=t and status='published')<>2 or (select count(*) from public.knowledge_bases where tenant_id=t and status='published')<>2 or (select count(*) from public.updates_posts where tenant_id=t and status='published')<>4 then raise exception 'Publication count mismatch'; end if;",
    'end $ct_content$;',
    "select 'Content and preservation assertions passed' as result;",
    commit ? 'commit;' : 'rollback;',
  );
  return lines.join('\n') + '\n';
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [input, output, mode] = process.argv.slice(2);
  if (!input || !output || (mode && mode !== '--commit')) throw Error('Usage: node scripts/prepare-workspace-content.mjs PRIVATE_SNAPSHOT OUTPUT_SQL [--commit]');
  const before = JSON.parse(readFileSync(input, 'utf8'));
  const after = prepareContent(before);
  writeFileSync(output, buildSql(before, after, {commit:mode === '--commit'}), {mode:0o600});
  console.log(`Prepared ${mode ? 'commit' : 'rollback-only'} content proposal. No services contacted.`);
}
