# CT Alt — Codex takeover
Updated 4 October 2026, 00:20 UTC. Recheck remote heads, credentials and deployments before acting.

## Goal and working style
Build the complete workforce application using Connecteam as the functional and visual reference, with original code/assets and CT Alt branding. The owner wants feature-by-feature and workflow parity, then later customisation. Do not silently narrow this to an MVP or claim affiliation. The latest direction prioritises desktop functionality; defer mobile polish while building supported workflows. Consult current public Connecteam guides for each module. Track actual implementation, tests, deployments and gaps in [FEATURE_COVERAGE.md](FEATURE_COVERAGE.md).

Own delivery: inspect a bounded reference area, implement, test, review, merge, deploy, verify, then continue. Use parallel workers for independent modules and one integrator for shared files, schema and releases. Default coding model: GPT-6.1 Sol medium. Everything stays free: no paid upgrades, usage-billed provisioning or new billing. Preserve the owner's working login. Never request credentials in chat; keep authorised credentials outside Git and browser bundles.

## Verified resources and boundaries
- Public repository: https://github.com/Jare7028/CT-Alt
- Production: https://ct-alt.vercel.app
- Vercel project: prj_vZtEYR5ihzJPziowsNitqVlgl3Gb; team: team_ts53ewLXSgnXNK0fPKOkCmOp.
- Supabase: clytszmnrssgvnlwfbrm, CT Alt, eu-west-1, organisation Jared, Free plan.
- Never touch Training-App / Resolvable Assess or another application's database, Auth, environment or deployment. Preserve the existing unrelated Supabase connection.
- Public source must contain no secrets, real workforce data, private screenshots or documents. Use synthetic fixtures only. App configuration permits only this verified project or the explicit isolated loopback stack; no application service-role credential.

## Latest verified release
Main3fe6a7eca11babcf5b98946032de4cf5140afc7d is production READY on dpl_3WQGsucDnXsZsZPj5azUzvdHGb63, aliased to ct-alt.vercel.app. Public login renders; unsigned Quick Tasks/Time Clock/Overview/Activity/Chat/Rotas pages redirect to login and valid unsigned API queries return401. Real-account authenticated production acceptance was not exercised. Exact current Connecteam visual parity remains unverified.

PR18 reviewed head23641bc303ea33fe7a205c5731e2888969cb84e8/tree5cca66da62586f7a65b3538415afcc2c446ce32f merged017c57b878c712ad444bdf353446b01dc920be74. CI37158960575 passed. Quick Tasks desktop lifecycle, shared/individual assignments, role-scoped completion, exact counts/paging/search and bounded searched assignee selection are released. Final56 config/query,82 isolated SQL/race and6 fresh real Auth/API/browser cases passed, plus check/build and independent final review. Actualmigration20261003222455 is byte-identical and was applied once with20 prior public table counts and18 prior function definitions/owners/ACLs retained.

PR17 reviewed head7e9061cecfed880312d7ed6fd967c874703c7603/tree54c04a56fcbf2acbfa7e21f824bb1b04627d5111 merged2f14a9c8e13e87edf9e3b191c5f17d4b3ec8b6ff. CI37157079995 passed. Desktop Time Clock jobs, own clock/break/history, owner/admin Today, company-aware navigation and employee entry links are released. Final48 config/query,111 isolated SQL/race and6 fresh real Auth/API/browser cases passed, with check/build and independent final review. Held-save/manual-refresh and delayed-response access races are covered; integrated desktop captures were inspected.

Delivered Users releases remain preserved: PR9 inline profile autosave/recovery (merge2939641), PR8 selected-user export/accessibility (merge10e7b16), and PR13 directory layout (merge37229f9). All32 fresh local Auth/API/browser directory cases passed with check/build,26 config and153 foundation/Agents assertions. Synthetic desktop/mobile controls and shell evidence were inspected before the owner's desktop-priority clarification.

New releases after CT Alt access was restored:

| PR | Reviewed head | Merge | Evidence |
| --- | --- | --- | --- |
| 7 Client Rotas | bfeb8b0d32f0250fe8063cf0cbe03baec0d80713 | 4fc1533c3498e6c5159bd3e771267bc333364eee | Exact existing hosted baseline; six RLS tables with authenticated SELECT-only/no anon access; 112 rota assertions and5 real local Auth/browser cases; CI37153626155 |
| 12 Schedule settings | f95adcf89ee892ccc2c7bd904296f6ab3193584a | 00e1bdf0e0687a435229c2630f4be63908002471 | Additive migration applied once; retained counts and function owner/ACL/definer/search path unchanged;134 rota assertions including populated upgrade/races and7 real local cases; CI37153886568 |
| 14 Complete Chat | a74e196b015641d49caed28bd29badfc9742dd64 | 35954c78b5cb92ec8a782c9620f7287e08766093 | Original PR5 work retained; both migrations applied once; five RLS tables, no anon or direct browser writes;274 combined SQL assertions,134 rota assertions,34 config and both real Auth acceptance runners; CI37154426688 |
| 15 Overview/Activity | 93f2f44cfb1a211d3f6408748e0de048f56ede49 | bdf5ddb53f305ecbdebf47e0b553b8323eb8684d | Signed-user counts/activity, current access rechecks, safe bigint/keyset/calendar handling;40 config/query tests and4 real Auth/API/browser cases; CI37155117506 |

PR16 consistent Overview counts reviewed headc5beca7d72b42aded9512bc63eea8f2bbcff76ea mergedcc68777b51877cf0f734fdd7a19751fff0dfd20d; CI37156487306 and productiondpl_5ovK7pn9PuzdkTn6LmJFkmqKWbBG READY/alias verified.

All final candidate trees passed check/build and independent review. Production READY/alias was verified per release. PR5 is merged through the preserved Chat work; no implementation was discarded. Chat posting denial invalidates earlier responses so delayed lists cannot restore composer permissions. Overview counts now share one STABLE SECURITY INVOKER statement snapshot; PR16 mergecc68777b51877cf0f734fdd7a19751fff0dfd20d is READY on production dpl_5ovK7pn9PuzdkTn6LmJFkmqKWbBG with ct-alt.vercel.app alias; CI37156487306 passed. Refreshed activity formatting follows the response timezone. Read [OVERVIEW_REVIEW.md](OVERVIEW_REVIEW.md), [CHAT_REVIEW.md](CHAT_REVIEW.md) and scheduling acceptance notes for limits.

## Actual applied database history
All fourteen hosted migration statements were reread and matched repository SQL byte-for-byte on4 October. Updates consumer release is pending; earlier statements are released. Preserve their exact identities and contents; never replay or rename an applied baseline.

- 20261003143058_workforce_foundation
- 20261003153745_agents_records
- 20261003191154_client_rotas (original proposal and registered migration remain blob b9a02a8cd36d895f6359403f17b615bafd0fcb4f)
- 20261003210226_client_rota_schedule_settings
- 20261003210622_chat_conversations
- 20261003210624_chat_group_permissions
- 20261003215100_workforce_overview_snapshot
- 20261003215840_time_clock_baseline
- 20261003222455_quick_tasks
- 20261003225247_team_timesheets
- 20261003231213_chat_message_search
- 20261003232647_chat_search_execute_permissions
- 20261003234421_time_off
- 20261004001913_updates

The migration endpoint assigns the actual recorded timestamp. The previously unapplied settings and Chat filenames were matched to those returned versions after application; SQL bytes did not change. Settings preserves existing data and mutation-function identity/owner/ACL/definer/search path. Existing security advisory findings are retained from the pre-migration baseline (the existing rls_auto_enable executable-definer warnings and leaked-password protection setting). Do not silently change unrelated Auth/advisory configuration. No production fixture records or messages were created.

CT Alt Management API access now works with the owner's authorised credential. The installed Supabase app connection may still be bound to the unrelated account/org; do not assume it targets CT Alt, and never use another project as fallback. Recheck the exact project, history and permissions before hosted changes. Use current documented read-only query endpoints for inspections and tracked migration application for reviewed additive SQL. Auth login/callback behaviour remains unchanged.

## Work in progress and next delivery
- Consistent Overview counts: reviewed one STABLE SECURITY INVOKER read with signed-user RLS, unchanged API shape/access rechecks;47 isolated snapshot/concurrency checks and4 fresh real Auth/browser cases passed. Additive migration applied once and metadata verified; PR16 exact consumer release is production-verified above.
- Time Clock: jobs, personal clock-in/out, manual paid/unpaid breaks, company Today attendance and own completed timesheets. Server-recorded time, tenant/current-membership/active-linked-agent checks, revisions, idempotent UUID actions, retained history and uncertain-write recovery. Final integration/review/check/build passed,48 config,111 isolated SQL/race and6 real Auth/API/browser cases passed. Migration20261003215840 applied once with exact SQL/retained count/function verification. Consumer released in PR17 with matching READY production above. Payroll, GPS/geofencing, approvals/manual edits and full Time Clock parity are future work.
- Continue the wider roadmap after these slices. Desktop functional workflows take priority over mobile polish.

Integration owner controls hosted SQL, shared navigation/pages, release and expected production SHAs. Workers must not apply hosted migrations or replay baselines. Existing applied history remains immutable.

## Verification workflow
Read AGENTS.md/package.json and current Next16 docs under node_modules/next/dist/docs. Run npm ci, check/config, build and appropriate isolated SQL/Auth/browser checks before pushes. Merge reviewed exact SHAs; verify remote main and matching Vercel production READY/alias. Distinguish local Auth evidence from real production acceptance.

All Auth fixtures own disposable labelled resources and exclusive loopback ports. The directory suite intentionally changes the synthetic admin's role; reset its fixture before a full rerun. Chat acceptance runners run sequentially. The Overview runner creates its own digest-pinned Auth/PostgREST/Postgres/Mailpit stack, labels/verifies its database, restores env files and removes its private fixture file; run separately from other Auth fixtures. Local service keys stay in fixture processes; the app receives only a local public anon key. Never use a production database for tests.

Test current permission/tenant boundaries, revocation, revisions, concurrent writes, timezone/DST, uncertain outcomes, failed recovery reads and preservation of populated upgrade data. Inspect rendered desktop output; CI alone does not prove browser behaviour. Keep mobile containment already implemented, but do not spend new effort on mobile polish under the latest owner direction.

## References
Connecteam account access is read-only: do not change schedules/users/settings or open chats in ways that mark messages read. Public official guides are preferred:
- https://help.connecteam.com/en/articles/6436008-the-overview-page
- https://help.connecteam.com/en/articles/6419701-the-activity-page
- https://help.connecteam.com/en/articles/8934869-managing-your-users-profiles
- https://help.connecteam.com/en/articles/4100339-starting-guide-to-the-job-scheduler
- https://help.connecteam.com/en/articles/8986051-creating-shifts
- https://help.connecteam.com/en/articles/6712594-chat-for-users
- https://help.connecteam.com/en/articles/10086009-getting-started-with-the-time-clock

The historical2023 admin-shell image cannot establish current pixel parity. Existing private controls observations informed Users layout, but their source crop is not public or reliably available in worker containers. All committed app screenshots are our own synthetic outputs; no competitor workforce image was imported.

Time Clock adds one INFO advisory for RLS enabled without policies on private time_clock_operations. This is intentional default-deny storage with anonymous/authenticated direct table privileges revoked. Existing warnings were unchanged. Do not add browser policies to silence it. Quick Tasks has passed signed desktop acceptance in its isolated worktree; its reviewed additive SQL is applied and PR18 consumer release is verified above.

Active worktrees: /workspace/ct-alt-time-off (released verified desktop consumer); /workspace/ct-alt-updates (desktop fixed-audience publishing/engagement implementation). Earlier Quick Tasks, Team Timesheets and Chat search releases are verified. Integrator owns shared pages/navigation, migration application, real Auth acceptance and release. The private receipt advisory is intentional; the Time Clock auth_rls_initplan performance warning is resolved through the new semantically equivalent additive policy migration. Applied baselines remain immutable.

Quick Tasks candidate passed independent final review,check/build,56 configs,82 SQL/race assertions and6 fresh real Auth/API/browser desktop cases. Its additive migration20261003222455 was applied once with exact SQL and all20 existing table counts/18 prior function definitions/owners/ACLs retained. PR18 consumer CI/merge/production verification is recorded above. Team-timesheet candidate passed independent final review, combined check/build,64 config/query,46 team SQL/upgrade/snapshot and111 retained Clock assertions plus6 fresh real Auth/API/browser cases. SQL20261003225247 was applied once with exact byte match;23 prior table counts and25 function definitions/owners/ACLs retained, security advisories unchanged and the Clock per-row Auth warning resolved. PR19 CI37160469769 passed; reviewed headcf6d4aeddf63b38fb2347f1a5ac0a948127e8b16 mergedcb3f6931ebf4773fe3cab9e8f19aaf7641987af8 and productiondpl_AU96UAmL3HK2XLVKyoGBqANYRhmh is READY with expected SHA/alias. Conversation search now passes72 combined configs,37 isolated SQL,29 synthetic and6 fresh signed Auth/browser cases; both recorded migrations match reviewed bytes and preserve23 prior table counts/30 other function definitions/owners/ACLs. PR20 consumer release is verified below. Time Off requests/types/approvals passed signed acceptance in /workspace/ct-alt-time-off; preserve Chat membership by Auth user, rather than altering authorization on agent-record relinks.

PR20 reviewed head8d83c9f80a8f7a80ddd3a260ad24f50996404baa/tree4988d11362e368ea0608ea78965dd9656b3b69c8 passed CI37162006287 and mergedaba80f323b4c5f5ddd9e03707837f1df40a98135. Matching productiondpl_9fdXveJxrBorDTq5n93uQM8BTrEH READY/alias verified; valid unsigned search returns401/private no-store.

Time Off /workspace/ct-alt-time-off integrated current main, passed check/build,79 combined config/query,97 SQL/race,17 synthetic and6 fresh signed real Auth/API/browser cases. Independent immutable server/UI/integration review found no blockers; inspected synthetic integrated desktop review capture committed. SQL20261003234421 was applied once with exact SHA25668e79c5518358eae48f05503137570b7bb62fc0294a8a537eb21cecb5c226c57 match;23 prior table counts and31 prior function definitions/owners/ACLs retained. Newtables SELECT-only RLS/newRPCs authenticated-only invokers; one private receipt INFO is intentional default-deny. PR21 reviewed head14ed9d8375b4af147aa53b19486cd74e8ff3089a/tree19d181eca9e42a3f3e8af7d6006b57a9c6dc320a passed CI37162952970 and merged3fe6a7eca11babcf5b98946032de4cf5140afc7d; matching productiondpl_3WQGsucDnXsZsZPj5azUzvdHGb63 is READY/alias verified. Valid unsigned Time Off API returns401/private no-store and the page redirects tologin. Updates in /workspace/ct-alt-updates passed combined check/build,90 configs,122 SQL/races,23 synthetic and8 fresh real local Auth/API/browser cases (1.9 minutes). Immutable server e22a4cf8ee67e564eb51f19df5467ecea4e632ab and UI/integration788cdc2cee2251870a06f1b9b41198bdb1519edf reviews found no blockers. Root inspected the signed synthetic desktop capture. SQL20261004001913 was applied once with exact SHA2563dacd9ab51e94d62a9f23390b6abe7e5063b730fa087fc4a541e57586ecbf474 match,26 prior table counts and38 prior function definitions/owners/ACLs retained. Four new tables use signed SELECT-only RLS; three public RPCs are authenticated-only invokers with empty search paths and no anon/service-role execute. One new private receipt INFO is intentional default-deny; existing findings retained. Consumer PR/exact-head CI/merge/production are pending. Root owns release, workers completed isolated scopes. No real workforce fixtures, notifications or paid resources.
