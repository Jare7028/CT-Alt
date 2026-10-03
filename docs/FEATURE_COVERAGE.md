# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Latest application release: `aba80f323b4c5f5ddd9e03707837f1df40a98135`. Vercel production `dpl_9fdXveJxrBorDTq5n93uQM8BTrEH` is READY and aliased to ct-alt.vercel.app. Live login renders; unauthenticated Agents/Time Clock/Quick Tasks redirect to login. Real-account authenticated production workflows were not exercised.

| Area | Implemented and tested evidence | Deployment | Remaining work |
| --- | --- | --- | --- |
| Sign-in and company access | Password and passwordless flows, confirmed identities, tenant boundaries; existing test suites | On main and production | Preserve the owner’s working login; verify delivery/configuration only when needed |
| Users/Agents | Directory, search, filters, sorting, columns, add/edit, archive/restore, CSV import/export, inline profile autosave/recovery, selected-user export; all 32 local Auth/API/browser cases and responsive controls reviews pass | On main and production | Invitations, update imports, configurable fields, detailed permissions and larger-directory pagination |
| Shared navigation | Topbar, grouped sidebar, collapse, mobile dialog and keyboard checks | On main and production | Enable each real module as released; full visual reference review |
| Client Rotas | PR7 baseline and PR12 settings/recovery; 32 config, 134 combined rota SQL assertions, populated upgrade preservation and seven real local Auth/API/browser cases pass | On main and production; baseline/settings history verified | open shifts, swaps, templates, repeats, requests and pagination |
| Chat | PR5/14 persistent direct/group messages, unread history, group administration and posting permissions; 28 config, 274 SQL, 13 component regressions and both real local Auth acceptance runners pass | On main and production; both migration histories verified | attachments, replies, global search, moderation, Realtime and complete appearance/mobile fidelity |
| Overview/Activity | Exact counts, owner/admin audit, action/calendar filters, safe bigint keyset, access rechecks;41 query/config and47 snapshot/concurrency assertions plus4 real local Auth/browser cases | On main and production | Consistent signed-user statement counts verified; attendance, engagement, alerts, other audit streams and full reference parity |
| Time Clock | Desktop jobs, personal clock-in/out, manual paid/unpaid breaks, Today and own timesheets;48 config,111 SQL/race and6 real Auth/API/browser cases | On main and production; PR17 CI37157079995 passed | Payroll/GPS/approvals/manual edits, automatic breaks and full reference parity |
| Quick Tasks | Desktop lifecycle, shared/individual assignments, own completion, role/tenant isolation, exact counts/paging and bounded searched assignees;56 config,82 SQL/race and6 real Auth cases | On main and production; PR18 CI37158960575 passed | Subtasks, comments, attachments, recurrence, notifications, Date view and granular feature permissions |
| Team timesheets | Owner/admin range/user review, exact completed totals, version-fenced keysets, retained names and whole-scope CSV with10,000 bound;64 combined config,46 team SQL,111 retained Clock and6 real Auth cases | On main and production; PR19 CI37160469769 passed | Payroll formats/rates/overtime, issues, approvals and manual edits |
| Conversation search | Joined-conversation literal search, exact counts/precise sequence paging and current permission rechecks;72 combined configs,37 SQL,29 synthetic and6 real Auth/browser cases | On main and production; PR20 CI37162006287 passed | Global search, sender/date/media filters and search-to-history navigation |
| Time Off | Full calendar-day types/requests, retained approvals/history, original-requester privacy and overlap-safe decisions;79 combined configs,97 SQL/races,17 synthetic and6 real Auth/browser cases | Reviewed SQL applied; consumer release pending | Partial days, policy assignments/balances/accrual, granular permissions and calendar/payroll integration |

## Wider workforce scope

These areas remain incomplete unless a release records specific evidence here:

- Attendance/engagement/alerts in Overview, wider Activity streams; global search, notifications and automations.
- Smart groups, detailed administrator permissions, organisational directory and job catalogue.
- Time clock, timesheets, attendance and payroll/reporting integrations.
- Time off, availability, open-shift requests and scheduling approval workflows.
- Updates, surveys, forms, quick tasks, contracts, knowledge bases and documents.
- Onboarding, hiring, courses, quizzes and training records.
- Events, help desk, rewards, recognition, celebrations and organisation chart.
- Employee mobile workflows, accessibility, large-directory pagination and complete visual fidelity.

## Release evidence

For every delivered slice, record functional scope, local checks, browser/API permission evidence, actual rendered desktop/mobile captures, deployed commit and hosted acceptance. Keep gaps explicit. Use synthetic fixtures and only verified CT Alt resources; all services remain free.

Latest owner direction: prioritise desktop functionality and keep consulting official Connecteam docs; defer new mobile polish.

Work underway: Time Off passed combined check/build and signed desktop acceptance; reviewed migration20261003234421 is applied, with consumer CI/merge/production verification pending. Desktop Updates publishing, fixed recipients and engagement workflows are next in /workspace/ct-alt-updates, informed by public guides. Preserve the wider roadmap.
