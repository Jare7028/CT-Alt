// Additional review regressions. Each race uses separate real PostgreSQL sessions.
export async function reviewRaceChecks({
  actorSql,
  sql,
  asyncSql,
  waitingTransaction,
  docker,
  name,
  overlap,
}) {
  const messages = [];
  const read = () =>
    JSON.parse(
      docker(
        [
          "exec",
          "-i",
          name,
          "psql",
          "-X",
          "-At",
          "-q",
          "-U",
          "postgres",
          "-d",
          "ct_alt_test",
        ],
        actorSql +
          "select public.read_rotas('50000000-0000-0000-0000-000000000001');",
      )
        .stdout.split("\n")
        .find((line) => line.startsWith("{")),
    );
  const before = read();
  const schedule = before.schedules.find((s) => s.name === "Race");
  const oldShift = before.shifts.find((s) => s.schedule_id === schedule.id);
  const changeTitle = (title) =>
    `select public.save_rota('50000000-0000-0000-0000-000000000001',jsonb_build_object('action','save_shift','schedule_id',(select id from public.rota_schedules where name='Race'),'revision',(select revision from public.rota_schedules where name='Race'),'id','${oldShift.id}','agent_id','${oldShift.agent_id}','job_id','${oldShift.job_id}','starts_at','${oldShift.starts_at}','ends_at','${oldShift.ends_at}','title','${title}'));`;
  // Reproduce the old route's separate-read interleaving at the SQL boundary.
  sql(actorSql + changeTitle("First concurrent update"));
  const after = read();
  if (
    oldShift.title === after.shifts.find((s) => s.id === oldShift.id).title ||
    schedule.revision ===
      after.schedules.find((s) => s.id === schedule.id).revision
  )
    throw Error("Separate-read race did not reproduce");
  messages.push(
    "PASS: separate SQL reads reproduce old-shift/new-revision interleaving",
  );
  let first = asyncSql(
    "set application_name='ct_alt_race';" +
      actorSql +
      "select public.read_rotas('50000000-0000-0000-0000-000000000001') from (select pg_sleep(2)) barrier;",
  );
  await waitingTransaction();
  sql(actorSql + changeTitle("Second concurrent update"));
  const consistent = await first;
  if (consistent.status !== 0)
    throw Error("Concurrent read failed: " + consistent.stderr);
  const snapshot = JSON.parse(
    consistent.stdout
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l.startsWith("{")),
  );
  if (
    snapshot.shifts.find((s) => s.id === oldShift.id).title !==
      "First concurrent update" ||
    snapshot.schedules.find((s) => s.id === schedule.id).revision !==
      after.schedules.find((s) => s.id === schedule.id).revision
  )
    throw Error("Read RPC mixed snapshots");
  messages.push(
    "PASS: read RPC retains one consistent snapshot during concurrent edit",
  );
  const fresh = read();
  if (
    fresh.shifts.find((s) => s.id === oldShift.id).title !==
      "Second concurrent update" ||
    fresh.schedules.find((s) => s.id === schedule.id).revision !==
      after.schedules.find((s) => s.id === schedule.id).revision + 1
  )
    throw Error("Fresh snapshot failed");
  messages.push(
    "PASS: next read observes both changed shift and changed schedule revision",
  );
  sql(
    "insert into public.rota_shifts(tenant_id,schedule_id,agent_id,job_id,starts_at,ends_at,status,published_at)select '50000000-0000-0000-0000-000000000001',s.id,a.id,j.id,'2027-02-01T09:00:00Z','2027-02-01T17:00:00Z','published',now() from public.rota_schedules s join public.rota_jobs j on j.schedule_id=s.id cross join public.agents a where s.name='Main' and j.name='Care' and a.phone='+447700900203';update public.rota_schedules set status='archived' where name='Main';",
  );
  first = asyncSql(
    "set application_name='ct_alt_race';begin;" +
      actorSql +
      "select public.save_rota('50000000-0000-0000-0000-000000000001',jsonb_build_object('action','restore','schedule_id',(select id from public.rota_schedules where name='Main'),'revision',(select revision from public.rota_schedules where name='Main')));select pg_sleep(2);commit;",
  );
  await waitingTransaction();
  let second = asyncSql(
    actorSql + overlap("Race two").replaceAll("2026-11-01", "2027-02-01"),
  );
  let results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("P0001")
  )
    throw Error("Restore/save concurrency failed");
  messages.push(
    "PASS: save queued behind restoration still requires overlap acknowledgement",
  );
  first = asyncSql(
    "set application_name='ct_alt_race';begin;" +
      actorSql +
      "select public.save_agents('50000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('action','archive','id',(select id from public.agents where phone='+447700900203'),'revision',(select revision from public.agents where phone='+447700900203'))));select pg_sleep(2);commit;",
  );
  await waitingTransaction();
  second = asyncSql(
    actorSql +
      "select public.save_rota('50000000-0000-0000-0000-000000000001',jsonb_build_object('action','publish','schedule_id',(select id from public.rota_schedules where name='Race'),'revision',(select revision from public.rota_schedules where name='Race')));",
  );
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("22023")
  )
    throw Error("Agent archive/publication race failed");
  messages.push(
    "PASS: publication queued behind target-agent archive rejects inactive assignment",
  );
  if (read().shifts.find((s) => s.id === oldShift.id).status !== "draft")
    throw Error("Rejected publication changed the draft");
  messages.push(
    "PASS: target-agent archive race leaves publication atomic and draft unchanged",
  );
  sql(
    actorSql +
      "select public.save_agents('50000000-0000-0000-0000-000000000001',jsonb_build_array(jsonb_build_object('action','restore','id',(select id from public.agents where phone='+447700900203'),'revision',(select revision from public.agents where phone='+447700900203'))));",
  );
  first = asyncSql(
    "set application_name='ct_alt_race';begin;delete from public.rota_admins where schedule_id=(select id from public.rota_schedules where name='Main') and user_id='00000000-0000-0000-0000-000000000202';select pg_sleep(2);commit;",
  );
  await waitingTransaction();
  second = asyncSql(
    "set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000202',false);select public.save_rota('50000000-0000-0000-0000-000000000001',jsonb_build_object('action','add_job','schedule_id',(select id from public.rota_schedules where name='Main'),'revision',(select revision from public.rota_schedules where name='Main'),'name','Revoked grant','color','#123456'));",
  );
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("42501")
  )
    throw Error("Delegated-grant revocation race failed");
  messages.push(
    "PASS: delegated grant revocation blocks a queued manager mutation",
  );
  return messages;
}
