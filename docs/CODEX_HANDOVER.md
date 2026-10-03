# CT Alt — Codex takeover
Updated 3 October 2026, 21:33 UTC. Recheck remote heads, credentials and deployments before acting.

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
Main bdf5ddb53f305ecbdebf47e0b553b8323eb8684d has production READY: dpl_9HgMuGZsy4mPDc5a74X1RMhrCcDy, aliased to ct-alt.vercel.app. Public login renders. Unauthenticated Overview, Activity, Chat and Client Rotas redirect to login; valid unsigned Overview/Activity/Rotas reads return401. Real-account authenticated production acceptance was not exercised. Exact current Connecteam visual parity remains unverified.

Delivered Users releases remain preserved: PR9 inline profile autosave/recovery (merge2939641), PR8 selected-user export/accessibility (merge10e7b16), and PR13 directory layout (merge37229f9). All32 fresh local Auth/API/browser directory cases passed with check/build,26 config and153 foundation/Agents assertions. Synthetic desktop/mobile controls and shell evidence were inspected before the owner's desktop-priority clarification.

New releases after CT Alt access was restored:

| PR | Reviewed head | Merge | Evidence |
| --- | --- | --- | --- |
| 7 Client Rotas | bfeb8b0d32f0250fe8063cf0cbe03baec0d80713 | 4fc1533c3498e6c5159bd3e771267bc333364eee | Exact existing hosted baseline; six RLS tables with authenticated SELECT-only/no anon access; 112 rota assertions and5 real local Auth/browser cases; CI37153626155 |
| 12 Schedule settings | f95adcf89ee892ccc2c7bd904296f6ab3193584a | 00e1bdf0e0687a435229c2630f4be63908002471 | Additive migration applied once; retained counts and function owner/ACL/definer/search path unchanged;134 rota assertions including populated upgrade/races and7 real local cases; CI37153886568 |
| 14 Complete Chat | a74e196b015641d49caed28bd29badfc9742dd64 | 35954c78b5cb92ec8a782c9620f7287e08766093 | Original PR5 work retained; both migrations applied once; five RLS tables, no anon or direct browser writes;274 combined SQL assertions,134 rota assertions,34 config and both real Auth acceptance runners; CI37154426688 |
| 15 Overview/Activity | 93f2f44cfb1a211d3f6408748e0de048f56ede49 | bdf5ddb53f305ecbdebf47e0b553b8323eb8684d | Signed-user counts/activity, current access rechecks, safe bigint/keyset/calendar handling;40 config/query tests and4 real Auth/API/browser cases; CI37155117506 |

All final candidate trees passed check/build and independent review. Production READY/alias was verified per release. PR5 is merged through the preserved Chat work; no implementation was discarded. Chat posting denial invalidates earlier responses so delayed lists cannot restore composer permissions. Overview currently has individually exact counts but no shared transactional snapshot; a dedicated follow-up is being implemented. Refreshed activity formatting follows the response timezone. Read [OVERVIEW_REVIEW.md](OVERVIEW_REVIEW.md), [CHAT_REVIEW.md](CHAT_REVIEW.md) and scheduling acceptance notes for limits.

## Actual applied database history
All six hosted migration statements were reread and matched released repository SQL byte-for-byte on3 October. Preserve their exact identities and contents; never replay or rename an applied baseline.

- 20261003143058_workforce_foundation
- 20261003153745_agents_records
- 20261003191154_client_rotas (original proposal and registered migration remain blob b9a02a8cd36d895f6359403f17b615bafd0fcb4f)
- 20261003210226_client_rota_schedule_settings
- 20261003210622_chat_conversations
- 20261003210624_chat_group_permissions

The migration endpoint assigns the actual recorded timestamp. The previously unapplied settings and Chat filenames were matched to those returned versions after application; SQL bytes did not change. Settings preserves existing data and mutation-function identity/owner/ACL/definer/search path. Security advisory findings are unchanged from the pre-migration baseline (the existing rls_auto_enable executable-definer warnings and leaked-password protection setting). Do not silently change unrelated Auth/advisory configuration. No production fixture records or messages were created.

CT Alt Management API access now works with the owner's authorised credential. The installed Supabase app connection may still be bound to the unrelated account/org; do not assume it targets CT Alt, and never use another project as fallback. Recheck the exact project, history and permissions before hosted changes. Use current documented read-only query endpoints for inspections and tracked migration application for reviewed additive SQL. Auth login/callback behaviour remains unchanged.

## Work in progress and next delivery
- Consistent Overview counts: one STABLE SECURITY INVOKER read with signed-user RLS, unchanged API shape/access rechecks, and concurrency/snapshot tests. New additive migration is local only until root review/application.
- Time Clock: jobs, personal clock-in/out, manual paid/unpaid breaks, company Today attendance and own completed timesheets. Server-recorded time, tenant/current-membership/active-linked-agent checks, revisions, idempotent UUID actions, retained history and uncertain-write recovery. New code/migration remains local until full integration/review. Payroll, GPS/geofencing, approvals/manual edits and full Time Clock parity are future work.
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
