# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Latest application release: `bdf5ddb53f305ecbdebf47e0b553b8323eb8684d`. Vercel production `dpl_9HgMuGZsy4mPDc5a74X1RMhrCcDy` is READY and aliased to ct-alt.vercel.app. Live login renders; unauthenticated Agents redirects to login. Real-account authenticated production workflows were not exercised.

| Area | Implemented and tested evidence | Deployment | Remaining work |
| --- | --- | --- | --- |
| Sign-in and company access | Password and passwordless flows, confirmed identities, tenant boundaries; existing test suites | On main and production | Preserve the owner’s working login; verify delivery/configuration only when needed |
| Users/Agents | Directory, search, filters, sorting, columns, add/edit, archive/restore, CSV import/export, inline profile autosave/recovery, selected-user export; all 32 local Auth/API/browser cases and responsive controls reviews pass | On main and production | Invitations, update imports, configurable fields, detailed permissions and larger-directory pagination |
| Shared navigation | Topbar, grouped sidebar, collapse, mobile dialog and keyboard checks | On main and production | Enable each real module as released; full visual reference review |
| Client Rotas | PR7 baseline and PR12 settings/recovery; 32 config, 134 combined rota SQL assertions, populated upgrade preservation and seven real local Auth/API/browser cases pass | On main and production; baseline/settings history verified | open shifts, swaps, templates, repeats, requests and pagination |
| Chat | PR5/14 persistent direct/group messages, unread history, group administration and posting permissions; 28 config, 274 SQL, 13 component regressions and both real local Auth acceptance runners pass | On main and production; both migration histories verified | attachments, replies, search, moderation, Realtime and complete appearance/mobile fidelity |

| Overview/Activity | Exact counts, owner/admin audit, action/calendar filters, safe bigint keyset, access rechecks;40 config/query tests and4 real local Auth/browser cases | On main and production | One-snapshot count consistency in progress; attendance, engagement, alerts, other audit streams and full reference parity |
| Time Clock | Server/UI implementation in progress: jobs, clock-in/out, manual breaks, Today and personal timesheets | Local work only | Complete isolated/real Auth integration and review; apply additive migration, deploy; payroll/GPS/approvals/manual edits remain future work |

## Wider workforce scope

These areas remain unimplemented unless a future release records specific evidence here:

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
