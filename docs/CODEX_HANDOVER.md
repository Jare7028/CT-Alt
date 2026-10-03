# CT Alt — Codex takeover
Updated 3 October 2026, 20:25 BST. Re-verify remote heads and deployments before acting.

## Goal and working style
Build the complete workforce application using Connecteam as the functional and visual reference. The owner wants close feature-by-feature and screen-by-screen parity, including navigation, layout and workflow details, before later customisation. Implement original code and assets; do not copy trademarks or claim affiliation. Do not silently narrow the goal to an MVP. Maintain a feature-coverage checklist that distinguishes implemented, tested, deployed and incomplete.

Own practical delivery: inspect a bounded reference area, implement it, test, merge, deploy, verify, then move to the next. Avoid long speculative planning. Use parallel workers for independent modules and one integrator for shared files/schema/releases. Default coding model: GPT-6.1 Sol medium; higher effort only when justified. Keep coherent work queued. Do not tell the owner something is live just because a branch or preview was pushed.

All resources must stay free for now. No paid services or upgrades. Obtain any genuinely required owner-only access or security approval through the supported flow; explain the service and purpose before requesting login. Never request passwords in chat.

## Repositories and services
- Repository: https://github.com/Jare7028/CT-Alt (public by owner choice).
- Production: https://ct-alt.vercel.app
- Vercel project: ct-alt / prj_vZtEYR5ihzJPziowsNitqVlgl3Gb
- Vercel team: team_ts53ewLXSgnXNK0fPKOkCmOp
- Supabase project: clytszmnrssgvnlwfbrm, CT Alt, region eu-west-1, organisation Jared, Free plan.
- Dedicated cloud coding environment CT-Alt now exists and selects this repository's main branch.
- Do not touch Training-App / Resolvable Assess, its Auth, database, environment variables or deployments. It is a separate live product.
- Public repo must never contain credentials, tokens, real workforce data, private documents or private reference screenshots. Use synthetic fixtures.
- Existing public development configuration uses only the intended publishable Supabase client configuration; no service-role key belongs in the application.
- Connected tools/access available in one session may not be present in another. Verify access, never assume it from this handover.

## Current verified release
Main commit 5c244db1cadfd65dcb3418c1a74147ccb928ea71 has Vercel production READY, deployment dpl_4NXNvzaNbUSmh1AaUyFUsVoD1jmr, verified 3 October 2026.
It includes:
- PR1 Agents directory and permission boundaries.
- PR2 passwordless email login alongside the existing login flow.
- PR3 advanced directory filters.
- PR4 add-only CSV import with preview/validation/atomic batches.
- PR6 read-only agent profiles.
- PR10 test database readiness correction.
- PR11 shared topbar/sidebar, verified module hierarchy and mobile navigation.

The shared shell is newly deployed. Exact current Connecteam full-screen pixel parity is NOT verified. Unimplemented modules remain visibly disabled; do not count them as completed.

Owner has successfully logged in and most recently said leave login alone and continue features. Do not redesign authentication or reset credentials as an unsolicited task. Previous magic-link frustration does not supersede that latest instruction.

## Immediate priority queue
1. Integrate already-reviewed Client Rotas PR7 into migration history, rerun tests, merge and verify production. Hosted schema is ALREADY applied; do not replay.
2. Fix PR9 autosave recovery defect, re-review, test and release.
3. Correct PR13 Users controls (stacked on PR8), test with the now-live shell, merge in dependency order.
4. Refresh/review Chat PR5 with the now-merged readiness fix; coordinate its unapplied migration carefully, test and release. PR14 adds Chat membership permissions and is a separate review.
5. Review PR12 schedule editing, then continue Client Rotas, Chat and Agents feature coverage. Keep shared shell/module route integration consistent.
Do not duplicate existing PRs or discard their work. Fetch current main first, inspect branch bases and preserve concurrent changes.

## Open PRs and exact review state
### PR7: Client Rotas baseline
https://github.com/Jare7028/CT-Alt/pull/7
Reviewed head f1d275750ed1c77bc6e500da5a55f02f92f94dba.
Draft/publish shifts, named schedules, assigned agents, manager delegation, jobs, day/week/month boards, archive/search, employee own-published-shift privacy.
Exact SQL proposal blob b9a02a8cd36d895f6359403f17b615bafd0fcb4f.
This exact proposal was applied ONCE to the intended CT Alt Supabase project and verified as:
20261003191154_client_rotas
Six empty rota tables, RLS enabled, authenticated SELECT-only, no anonymous access, ten FKs and timezone triggers checked. Existing records preserved; no hosted fixtures created.
Required repository alignment:
- Add supabase/migrations/20261003191154_client_rotas.sql with the EXACT proposal SQL.
- scripts/test-rotas-database.mjs currently applies all migrations then separately loads docs/proposals/client-rotas.sql; remove that separate load (around lines216–221).
- scripts/rotas-browser-fixture.mjs also separately loads the proposal after migrations (around line203); remove it.
- Preserve migration loops, assertions, proposal history if desired, and additive /rotas/:path* proxy matcher.
- Update outdated proposal-only/no-hosted-migration docs and CI label.
Otherwise CREATE TABLE runs twice and tests fail.
Evidence before registration:112 rota SQL assertions,153 baseline/Agents SQL assertions, config/timezone tests, four real local Auth/browser/API tests. CI https://github.com/Jare7028/CT-Alt/actions/runs/37143879952.
Read docs/client-rotas-acceptance.md for gaps.
Performance-only advisories after hosted apply: two per-row auth RLS warnings, six unindexed FKs and two unused indexes. No further changes made; assess separately.

### PR9: Agent profile blur-autosave
https://github.com/Jare7028/CT-Alt/pull/9
Head1591d578139586f5d47b49de265b06df607de3a9. CI and preview pass; author reports28 browser tests,26config,153SQL assertions.
RELEASE BLOCKER: in app/agents/[agentId]/edit-details.tsx, fail() marks uncertain saves unknown, but navigate() and departure() overwrite that with saved whenever hasSaved.current is true.
Reproduce: save Title successfully, save Team with a committed write but lost acknowledgement, leave explicitly or browser Back, then return. Recovery marker can incorrectly say saved at the older acknowledged revision.
Preserve unknown/locked recovery across departure; regression must cover successful save THEN lost acknowledgement THEN leave/back THEN return.
Server revisions still prevent stale overwrites, but UI recovery is wrong. Do not merge until corrected.
The PR's test-database readiness change is identical to main PR10; preserve it, no duplicate fix needed.

### PR8 + stacked PR13: Users controls
https://github.com/Jare7028/CT-Alt/pull/8
PR8 head905ce0abfd2bca30715edf05612564fa89c9afb4.
https://github.com/Jare7028/CT-Alt/pull/13
PR13 head31d9f756a2999a6352b3012036b2d675e5a5a9b4; targets PR8 branch.
Review blockers:
- Export accessible name becomes Export all matching users but tests/browser/selection.spec.ts still asks for Export visible users.
- Fixed72px final column clips horizontally laid-out Edit/Archive row actions. Provide adequate width or an accessible compact menu; inspect desktop/mobile and hidden-name-column states.
- scripts/review-directory-controls.mjs assumes1084px card at1184px viewport, based on old60px rail. New190px sidebar makes card954px. Test matched-card geometry at an appropriate viewport AND narrower real combined layouts.
Run full browser suite and both shell/controls visual reviews on integrated final code. Current CI only runs check/config/DB/build, so green CI did not catch these bugs.
No authorization bypass found in review; CSV neutralisation preserved.
Never commit the private reference image.

### PR5: Chat baseline
https://github.com/Jare7028/CT-Alt/pull/5
Reviewed corrected head7891bd8864df0ab993d236d3dad96a3522abfaee.
Migration proposal filename20261003171238_chat_conversations.sql; SQL blob750fd82ffcad8d34f6d1b429f5190d020d58de6f. NOT applied to hosted CT Alt.
Review fixes already made: stale asynchronous response fencing, reselect-history clearing, /chat/:path* proxy cookie refresh.
Earlier CI37143849977 failed during PostgreSQL startup before migration execution; PR10 main fixes this. Rebase and rerun.
244DB assertions,10component tests and real local Auth acceptance were reported. Read scripts/test-chat-integration.mjs and docs/CHAT_REVIEW.md.
Improve tests to assert Set-Cookie on actual /chat navigation and disable polling during205-message insertion for deterministic reconnect pagination.
Do not treat code approval conditional on green CI as deployment proof.

### PR14: Chat Info and permissions
https://github.com/Jare7028/CT-Alt/pull/14
Head3bb2fdb26c3aec619e4960431d6d139e6b469722.
Chat Info, membership management, group admins, admin-only posting, audit, conflicts.
Reported exact-head CI,28config,274DB assertions,12browser regressions and real Auth matrices pass.
Independent review and migration coordination still pending. Hosted migration NOT applied.
Missing: attachments, replies, search, dynamic groups, moderation, Realtime and full UI fidelity.

### PR12: Schedule editing
https://github.com/Jare7028/CT-Alt/pull/12
Head5fea1099550e97d761ba98b1c0e2a8168b849ebb, stacked onPR7.
Owner/admin edit names,timezones,assignedusers,delegatedmanagers; preserves shift instants/publication and revisions.
132SQL,19config/time,5realAuthbrowser tests reported. CI37145003764 passes.
Independent review and additive hosted SQL review still pending. Do not apply blindly.
Read docs/client-rotas-settings-acceptance.md.

## Database and auth ground truth
Already applied migrations:
- 20261003143058_workforce_foundation
- 20261003153745_agents_records
- 20261003191154_client_rotas
Re-read remote migration history before any changes. Do not create duplicate timestamps or replay non-idempotent SQL.
One tenant and one active owner membership existed at last verification; zero agents and agent audit rows. No production test fixtures were created.
Auth site URL https://ct-alt.vercel.app; allowed redirect https://ct-alt.vercel.app/auth/callback.
Email confirmation on, anonymous sign-in off. No need to change these for feature development.
Keep cross-tenant isolation, server/database checks, optimistic revisions, audit and revocation enforcement. UI hiding is not security.
Baseline security warnings (not introduced by rotas): rls_auto_enable definer execution advisory and disabled leaked-password protection. Do not silently alter security settings.
Never put credentials into public code or this document.

## Verification and releases
Read package.json and AGENTS.md. Use npm ci, npm run check, npm run test:config, npm run build and the appropriate database/browser/visual scripts.
CI success is not evidence of browser success: inspect actual workflow coverage.
Tests should use disposable local Auth/PostgREST/Postgres and synthetic data, not real employees or the reference company's tenant.
Include interrupted/repeated flows, stale writes, cancellation/back, lost acknowledgements, suspension/revocation, tenant boundaries and timezone/DST tests.
Use current Next.js16 documentation shipped under node_modules/next/dist/docs.
Merge only the reviewed final SHA after tests; preserve shared changes. Verify the expected commit on main and Vercel production READY. Verify live route/navigation behaviour where access permits; explicitly distinguish deployment status from authenticated end-to-end testing.
One integration owner should coordinate schema history and shared shell/proxy changes. Do not leave a heap of preview branches while claiming delivery.
A dev-only braces advisory remains without a patch; production audit was0. Do not suppress checks or downgrade ESLint blindly.

## Reference workflow and visual evidence
Connecteam account is READ-ONLY reference. Do not change schedules/users/settings or open chats in a way that changes read state. Public official articles can supply safe reference examples.
https://help.connecteam.com/en/articles/1879478-how-do-i-add-an-admin
https://help.connecteam.com/en/articles/8934869-managing-your-users-profiles
https://help.connecteam.com/en/articles/4100339-starting-guide-to-the-job-scheduler
https://help.connecteam.com/en/articles/8986051-creating-shifts
https://help.connecteam.com/en/articles/6712594-chat-for-users
The full-shell image from the admin article is historical2023, despite a newer article date; it cannot prove current pixel parity.
Current private Users controls crop was inspected by reviewers but was not reliably available inside coding containers. No claim that those workers saw it.
Current observed hierarchy: topbar search/help/notifications/profile; static Overview,Activity,Users,Smart groups,Automations,Job list; grouped Communication,Operations,HR & Skills. Use original CT Alt branding; don't copy private client-specific labels.
Synthetic before/after captures are already in repo docs/screenshots and tests/visual-reference. They are safe test data.
For visual work, compare actual rendered screenshots, not descriptions alone. Mark evidence gaps honestly.

## Suggested first instruction
Read AGENTS.md and this file, verify remote main and open PRs, and take ownership of the next small tested live release. Start with PR7 migration-history alignment and the documented PR9/PR13 review defects. Use sensible parallel work, keep one integration owner, and continue module by module toward complete Connecteam feature/UI coverage. Keep everything on free resources and keep Assess untouched. Report live results and genuine blockers, without repeatedly asking the owner to approve already-requested development.
