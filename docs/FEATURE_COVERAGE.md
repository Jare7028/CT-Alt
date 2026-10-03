# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Latest application release: `cb3f6931ebf4773fe3cab9e8f19aaf7641987af8`. Vercel production `dpl_AU96UAmL3HK2XLVKyoGBqANYRhmh` is READY and aliased to ct-alt.vercel.app. Live login renders; unauthenticated Agents/Time Clock/Quick Tasks redirect to login. Real-account authenticated production workflows were not exercised.

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

Work underway: conversation search passed72 combined config/query,37 SQL,29 synthetic and6 fresh signed Auth/browser cases; exact reviewed SQL/ACL migrations are applied, with consumer release pending. Time Off types, own requests and owner/admin team approvals are under active implementation. These candidates require exact CI/merge/production verification before being described as live.
