import { chatGroupRaceChecks } from "./chat-group-race-checks.mjs";
// All statements run only in test-database's fresh network-disabled container.
export async function chatRaceChecks({ sql, asyncSql, waitingTransaction }) {
  const actor =
    "set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-000000000301',false);";
  const conversation =
    "(select id from public.chat_conversations where tenant_id='30000000-0000-0000-0000-000000000001' and kind='direct')";
  const send = (clientId) =>
    `select public.chat_action('30000000-0000-0000-0000-000000000001',jsonb_build_object('action','send','conversationId',${conversation},'clientId','${clientId}','body','Concurrent synthetic'));`;
  const held = (statement) =>
    asyncSql(
      "set application_name='ct_alt_race';begin;" +
        statement +
        "select pg_sleep(2);commit;",
    );
  const notes = [];
  const duplicateId = "50000000-0000-0000-0000-000000000010";
  let first = held(actor + send(duplicateId));
  await waitingTransaction();
  let second = asyncSql(actor + send(duplicateId));
  let results = await Promise.all([first, second]);
  if (results.some((result) => result.status !== 0))
    throw new Error("Concurrent chat retry failed: " + JSON.stringify(results));
  sql(
    `do $$begin if (select count(*) from public.chat_messages where client_id='${duplicateId}')<>1 then raise exception 'Duplicate retry created extra message'; end if;end$$;`,
  );
  notes.push("PASS: concurrent duplicate sends persist exactly one message");
  first = held(actor + send("50000000-0000-0000-0000-000000000011"));
  await waitingTransaction();
  second = asyncSql(actor + send("50000000-0000-0000-0000-000000000012"));
  results = await Promise.all([first, second]);
  if (results.some((result) => result.status !== 0))
    throw new Error("Concurrent ordered sends failed");
  sql(
    "do $$begin if (select sequence from public.chat_messages where client_id='50000000-0000-0000-0000-000000000012')<>(select sequence+1 from public.chat_messages where client_id='50000000-0000-0000-0000-000000000011') then raise exception 'Message ordering failed'; end if;end$$;",
  );
  notes.push("PASS: simultaneous sends commit in server sequence order");
  first = held(
    "update public.tenant_memberships set status='suspended' where tenant_id='30000000-0000-0000-0000-000000000001' and user_id='00000000-0000-0000-0000-000000000301';",
  );
  await waitingTransaction();
  second = asyncSql(actor + send("50000000-0000-0000-0000-000000000013"));
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("42501")
  )
    throw new Error("Concurrent chat suspension failed");
  notes.push("PASS: concurrent suspension denies queued chat send");
  sql(
    "update public.tenant_memberships set status='active' where user_id='00000000-0000-0000-0000-000000000301';",
  );
  first = held(
    "delete from public.chat_members where user_id='00000000-0000-0000-0000-000000000301' and conversation_id=" +
      conversation +
      ";",
  );
  await waitingTransaction();
  second = asyncSql(actor + send("50000000-0000-0000-0000-000000000014"));
  results = await Promise.all([first, second]);
  if (
    results[0].status !== 0 ||
    results[1].status !== 3 ||
    !results[1].stderr.includes("42501")
  )
    throw new Error("Concurrent chat removal failed");
  notes.push("PASS: concurrent conversation removal denies queued chat send");
  const reopen = await asyncSql(
    actor +
      `select public.chat_action('30000000-0000-0000-0000-000000000001','{"action":"create","kind":"direct","members":["00000000-0000-0000-0000-000000000302"]}');`,
  );
  if (reopen.status !== 3 || !reopen.stderr.includes("42501"))
    throw new Error(
      "Empty direct conversation silently restored removed members",
    );
  notes.push(
    "PASS: direct reopening cannot restore an entirely removed membership",
  );
  notes.push(
    ...(await chatGroupRaceChecks({ sql, asyncSql, waitingTransaction })),
  );
  return notes;
}
