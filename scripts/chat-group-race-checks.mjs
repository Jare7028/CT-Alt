// Called only with the fresh, unpublished PostgreSQL runner's SQL functions.
export async function chatGroupRaceChecks({
  sql,
  asyncSql,
  waitingTransaction,
}) {
  const t = "40000000-0000-0000-0000-000000000001";
  const a = "00000000-0000-0000-0000-000000000401";
  const b = "00000000-0000-0000-0000-000000000402";
  const actor = (id) =>
    `set role authenticated;select set_config('request.jwt.claim.sub','${id}',false);`;
  sql(
    `update public.tenant_memberships set status='active' where tenant_id='${t}';`,
  );
  const create = await asyncSql(
    actor(a) +
      `select public.chat_action('${t}','{"action":"create","kind":"group","name":"Group race","members":["${b}"]}');`,
  );
  if (create.status !== 0) throw Error("Group race setup failed");
  const c = `(select id from public.chat_conversations where tenant_id='${t}' and name='Group race')`;
  const manage = (rev, admins, posting) =>
    `select public.chat_action('${t}',jsonb_build_object('action','manage_group','conversationId',${c},'revision',${rev},'members',jsonb_build_array('${a}','${b}'),'group_admins',jsonb_build_array(${admins.map((id) => `'${id}'`).join(",")}),'allow_member_messages',${posting}));`;
  const held = (statement) =>
    asyncSql(
      "set application_name='ct_alt_race';begin;" +
        statement +
        "select pg_sleep(2);commit;",
    );
  const notes = [];
  let first = held(actor(a) + manage(1, [a], false));
  await waitingTransaction();
  let second = asyncSql(actor(a) + manage(1, [a], true));
  let results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("40001")
  )
    throw Error("Concurrent group edit conflict failed");
  notes.push("PASS: simultaneous group edits reject stale revision");
  sql(actor(a) + manage(2, [a, b], false));
  first = held(actor(a) + manage(3, [a], false));
  await waitingTransaction();
  second = asyncSql(
    actor(b) +
      `select public.chat_action('${t}',jsonb_build_object('action','send','conversationId',${c},'clientId','70000000-0000-0000-0000-000000000001','body','Revoked group admin'));`,
  );
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("P0001")
  )
    throw Error("Concurrent group admin revocation failed");
  notes.push("PASS: queued send checks newly revoked group admin permission");
  first = held(
    `update public.tenant_memberships set status='suspended' where tenant_id='${t}' and user_id='${a}';`,
  );
  await waitingTransaction();
  second = asyncSql(actor(a) + manage(4, [a], true));
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("42501")
  )
    throw Error("Concurrent group manager suspension failed");
  notes.push("PASS: queued group edit checks newly suspended actor");
  return notes;
}
