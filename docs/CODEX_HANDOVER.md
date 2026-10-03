# CT Alt — Codex takeover
Updated 3 October 2026, 20:38 UTC. Re-verify remote heads and deployments before acting.

## Goal and working style
Build the complete workforce application using Connecteam as the functional and visual reference. The owner wants close feature-by-feature and screen-by-screen parity, before later customisation. Use original code/assets and CT Alt branding. Do not silently narrow this to an MVP or claim affiliation. Track implemented, tested, deployed and incomplete scope in [FEATURE_COVERAGE.md](FEATURE_COVERAGE.md).

Own delivery: inspect a bounded reference area, implement, test, review, merge, deploy, verify, then continue. Use parallel workers for independent modules and one integration owner for schema/shared files/releases. Default coding model: GPT-6.1 Sol medium. Keep coherent work queued; do not equate previews with live features. Everything must remain free. No paid services/upgrades or credentials requested in chat.

## Resources and boundaries
- Public repository: https://github.com/Jare7028/CT-Alt
- Production: https://ct-alt.vercel.app
- Vercel project: prj_vZtEYR5ihzJPziowsNitqVlgl3Gb; team: team_ts53ewLXSgnXNK0fPKOkCmOp.
- Supabase: clytszmnrssgvnlwfbrm, CT Alt, eu-west-1, organisation Jared, Free plan.
- Dedicated coding environment selects this repository.
- Never touch Training-App / Resolvable Assess, its Auth, database, environment or deployments. Keep the owner's existing Supabase connection; add the CT Alt connection separately.
- Never commit secrets, private screenshots/documents or real workforce data. Use synthetic fixtures. App configuration accepts only this intended public Supabase binding or the explicit isolated loopback stack; never put a service-role key in the app.
- Owner has working login and explicitly asked to leave it alone. Do not redesign Auth/reset credentials as unsolicited work.

## Latest verified application release
Main `37229f9640235a3c2d8d3d9f08baa6b3cbc76144` has production READY: `dpl_7exAWu1mk9T2vJvBD4x6YW2YoLn5`, aliased to ct-alt.vercel.app.
Earlier releases include Agents permissions/CRUD, passwordless login, advanced filters, add-only CSV import, read-only profiles and shared topbar/sidebar/mobile navigation.
This session delivered:
- PR9 inline profile blur saves and durable uncertain-save recovery. Reviewed head 6902adf106cbc70e836387da1e2234e5e052ee39; merged 2939641149d78beaf08f3a17f82c7b57f6535e7b. All 30 local Auth/API/browser cases passed; CI 37150970218 passed.
- PR8 selected-user export and accessible directory controls. Reviewed head e67a27e9b6c0d04264f1ec0f1c2f34d2c5ee32dd; merged 10e7b16accc8dbfadaa574c47354305fb3db1c65. All 32 browser/API cases passed; CI 37151342648 passed.
- PR13 measured Users layout and contained row actions. Reviewed head 19e879612999397df4c3f2ca68810b90d4ff6056; merged 37229f9640235a3c2d8d3d9f08baa6b3cbc76144. All 32 browser/API cases passed; CI 37151633691 passed. Rendered controls reviews passed at 1314/1184/900/390px, including hidden First name, View/Edit/Archive, export/selection and keyboard cancellation. Shell desktop/mobile focus/navigation checks passed.
All three releases passed check/build, 26 config tests and 153 isolated foundation/Agents assertions. Independent review found no remaining blocker. Live login renders and unauthenticated Agents redirects to login; real-account production end-to-end flows were not exercised. Exact current Connecteam pixel parity remains unverified; disabled modules remain incomplete.

## Prepared branches and next delivery
No duplicate PRs were created. Existing draft branches now include the released main and exact tested trees:

| PR | Head | Status |
| --- | --- | --- |
| [7 Client Rotas](https://github.com/Jare7028/CT-Alt/pull/7) | f21f728c4190bdbe06b7a7ad6496515cffb58066 | Shared shell, applied-migration registration, uncertain-save lock; hosted history verification pending |
| [12 Schedule settings](https://github.com/Jare7028/CT-Alt/pull/12) | 4c41233977d3f583a80fae0c6f26e41d0f8f91be | Targets PR7; additive migration and all seven real Auth/browser cases verified locally |
| [14 Chat permissions](https://github.com/Jare7028/CT-Alt/pull/14) | e5e9d91944aa46cb7cd9f8e399fa5fa9d00cb1bf | Includes baseline PR5 and shared shell; both hosted migrations unapplied; Chat module links disabled |

PR7 baseline previously passed 112 rota SQL assertions and five real local Auth/browser cases. It registers exact `20261003191154_client_rotas.sql` (blob b9a02a8cd36d895f6359403f17b615bafd0fcb4f), identical to the already-applied proposal. Both local runners load migration history once. Refreshed shell/check/build pass with released Users/profile behavior preserved.

PR12 keeps that baseline/proposal immutable. New `20261003202600_client_rota_schedule_settings.sql` widens the audit action CHECK and replaces only workforce_private.save_rota. It preserves function identity, owner, ACL, definer and search path. Tests cover populated upgrade preservation, races, retained shifts, timezone instant/publication preservation, revision/permission checks and committed-save/lost-response recovery. Passed 134 rota SQL assertions, 32 config, 153 foundation/Agents assertions,check/build and all seven real local Auth/API/browser cases. Independent final review found no blocker. Read docs/client-rotas-settings-acceptance.md before applying anything.

Chat baseline PR5 remains preserved in PR14. No Chat SQL was changed by this integration. Fixed stale list responses that could restore posting controls after denial; all asynchronous completions are generation-fenced. Passed 274 isolated SQL assertions, 28 config, 13 component regressions,check/build and both sequential real Auth acceptance runners. Coverage includes actual Set-Cookie refresh, persistence/retries, 205-message reconnect, tenant/private-group boundaries, membership removal/suspension, roles, group administration and posting restrictions. Real group UI containment at 1280/390px and synthetic screenshots inspected. Independent review found no blocker. Read docs/CHAT_REVIEW.md. Attachments, replies, search, moderation, Realtime and full UI/mobile fidelity remain incomplete.

Exact-head CI passed: PR7 run 37152226867, PR12 run 37152234692 and PR14 run 37152231074. These green runs do not satisfy the hosted database gate.

Next: restore the dedicated CT Alt Supabase connection; verify hosted history and schema; release PR7 without replaying its applied migration; coordinate additive PR12 and Chat migrations; verify expected production commits and actual accessible flows; continue feature coverage. Do not merge a schema-dependent route while its hosted prerequisites are unverified.

## Hosted database gate
The connected Supabase tool currently returns no permission for the exact CT Alt project. The owner believes its account is jared_clapham@hotmail.co.uk and has been asked to authorise a separate connection while retaining the existing one. Do not assume account access from older sessions or touch another project as a fallback.

Earlier verified applied migrations:
- 20261003143058_workforce_foundation
- 20261003153745_agents_records
- 20261003191154_client_rotas (applied exactly once)

Re-read actual hosted history before changes. Do not replay baseline SQL or replace an applied timestamp. The new settings migration and Chat 20261003171238/20261003183901 migrations remain unapplied. Earlier hosted rota verification found six empty tables, RLS, authenticated SELECT-only grants, ten FKs and timezone triggers, with existing data preserved. No production fixtures were created in this session.

Preserve tenant isolation, current membership authorization/revocation, optimistic revisions and audit. Existing Auth site URL/redirect is ct-alt.vercel.app and /auth/callback; email confirmation on, anonymous sign-in off. Baseline security advisories and performance-only rota RLS/FK/index advisories were not silently changed.

## Verification workflow
Read AGENTS.md and package.json. Run npm ci, check, config, build and appropriate database/browser/visual scripts before pushes. Use current Next16 docs under node_modules/next/dist/docs. Merge only reviewed final SHAs; verify remote main and expected Vercel production READY/alias. Distinguish deployment status, local tests and real production Auth acceptance.

Fixtures must be disposable, label-verified and CT Alt-only. Never use real employees/reference-company data. Reset the entire fixture before repeating a full directory suite: archive/restore intentionally demotes the synthetic admin, so rerunning against mutated data is invalid. The temporary shared Mailpit fixture followed Auth redirects manually for browser PKCE; product login code was unchanged. Chat runners own their exclusive stack and must run sequentially; scheduling uses its separate random-labelled fixture. Only remove resources/files belonging to the current test run.

Include interruption, cancellation/back, stale revisions, committed writes with lost responses, failed recovery reads, tenant boundaries, revocation, timezone/DST and populated-upgrade preservation where relevant. CI success alone does not prove browser success. All current screenshots in the repo are synthetic local outputs; no competitor/private workforce image was committed.

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
