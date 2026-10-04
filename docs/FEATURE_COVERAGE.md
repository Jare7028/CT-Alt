# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Latest verified application release: `de023f0edb6db888062661c59bdbcd5e4c83dec8` (PR32 Requests), after PR29 shell/scheduling, PR30 profile/typography and PR31 Time Clock styling. Matching Vercel `dpl_CrievaTxw817FiZHhz25Pe9LHJgt` is READY and aliased to ct-alt.vercel.app. Exact-head CI `37200205189` passed. The Requests schema and 48 cards are already live; all 20 migration identities remain immutable.

The owner-authorised fictional workspace now has natural names and operational content: 21 staff profiles, 3 schedules/60 published shifts, 6 Clock jobs, 12 Quick Tasks, 48 distinct Requests, 4 published Updates/2 drafts, 2 published handbooks and 2 published forms. The owner explicitly superseded the original visible Demo-label convention. Auth/login/membership/settings and historical data are preserved; no new accounts, invitations, messages, notifications or fabricated attendance/submissions were created. Read [content and verification](LIVE_DEMO_DATA.md). Four guard tests plus the existing suite total 190 passing configuration tests; check/build and independent review pass. Data-role RPC verification and unsigned production smoke passed; a new authenticated browser session was not tested.

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
| Time Off | Full calendar-day types/requests, retained approvals/history, original-requester privacy and overlap-safe decisions;79 combined configs,97 SQL/races,17 synthetic and6 real Auth/browser cases | On main and production; PR21 CI37162952970 passed | Partial days, policy assignments/balances/accrual, granular permissions and calendar/payroll integration |
| Updates | Owner/admin lifecycle, fixed Auth-member recipients, viewed/confirmed tracking, reactions and own comments;90 combined configs,122 SQL/races,23 synthetic and8 real Auth/browser cases | On main and production; PR22 CI37164745377 passed | Media/templates, Smart Groups, scheduling, user posting, published edits, notifications, exports and granular permissions |
| Updates recipient export | Complete selected-status CSV, safe UTF8/formula cells, retained names and precise UTC, fresh role/post checks;98 configs,24 export SQL,122 retained Updates SQL,50 synthetic and6 real Auth/browser cases | On main and production; PR23 CI37166027333 passed | Reference-verified format, custom columns/Excel, group-by and granular export permissions |
| Smart Groups/segments | Dynamic case-sensitive AND/OR profile rules, exact record/eligibility counts beyond1000, saved segments/groups, membership previews, lifecycle/revision/UUID recovery;108 configs,59 SQL/races,47 synthetic and8 real local Auth/API/browser cases | On main and production; PR24 CI37169681084 passed | Protected account groups, typed/date operators, delegated permissions, Users Save as Group, profile memberships and dynamic feature audiences |
| Knowledge Base | Desktop multiple bases/nested folders/plain text/links, fixed Auth assignment, moves/order/title search, explicit reader views and genuine insights;119 configs,94 SQL/races,57 synthetic and8 real local Auth/API/browser cases | On main and production; PR25 CI37175077530 passed, schema20261004034015 applied once | Private files, rich text, dynamic groups, granular administrators, export and complete reference workflows |

| Private Knowledge Base files | Private upload/replacement/download, bounded lifetime allocation, original-actor recovery and provider proofs;128 configs,43 genuine Storage/SQL/races,117 synthetic and9 fresh real Auth/API/browser cases | Draft PR26, exact-head CI37179671259 passed; hosted schema/bucket/server verifier configuration remain unapplied pending Vercel authentication | Release after private server configuration; rich text, granular file permissions and complete reference workflows |
| Desktop Forms | Builder/fixed assignments, lifecycle, six ordered fields, private autosave, submit/edit/review/history and recovery;147 configs,97 SQL/races,68 synthetic and10 fresh real Auth/API/browser cases1.8min; all12 retained SQL suites/check/build pass | On main and production; schema20261004063200 applied once, PR27 CI37183327315 passed | Summaries/export, dynamic audiences, published schema edits, conditions/formulas, repeat responses, advanced fields and full reference parity |

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

Work underway: desktop Forms follows the [reviewed contract](FORMS_CONTRACT.md) and official linked Forms guides. Private Knowledge Base files remain in reviewed draftPR26 while secure Vercel authentication is pending for server-only verifier settings. Forms is independent of those settings. Keep completing and verifying desktop workflows, then continue the wider roadmap.

Desktop Forms reporting is now in active implementation under [reporting contract](FORMS_REPORTING_CONTRACT.md): date/filter submissions, current-assignee status, question summaries/drilldown and genuine complete filtered XLSX exports. No reporting schema or consumer is released yet.

| Desktop Forms reporting | Submitted-only filtered entries, complete assigned-user status, exact per-question summaries/drilldown and genuine streamed XLSX;174 configs/58 SQL/111 synthetic/8 new plus10 retained real Auth cases; all13 retained SQL/check/build pass | Local acceptance complete; schema20261004080045 applied once; exact CI/consumer release pending | PDF, custom export formats, dynamic audiences, published schema edits, repeat responses and complete reference parity |

Read [reporting acceptance](forms-reporting-acceptance.md) and [the explicit reporting scope/bounds](FORMS_REPORTING_CONTRACT.md). Whole-scope entry limits do not guarantee every finished workbook fits the separate8MiB cap. Signed original built desktop captures were inspected. Private files current integrated PR26 head9ceffe3 passed renewed CI37186072208; no file schema/bucket/verifier configuration is provisioned. Before files release, integrate the latest actual reporting main/history. New desktop schedule-template implementation is underway separately from actual mainabe0913; current official template guides are the reference and all outputs remain drafts until separate publication.

Reporting additiveSQL20261004080045 was applied once with reviewed bytes;51 existing table counts/row digests,112 function identities/security metadata and table/column grants/RLS/policies retained, no new security findings. CTAltFree remainshealthy;19 registered migrations. Consumer release still pendingCI. Privatefiles provisioning must incorporate these19 actual identities.


| Requests kanban | Company-scoped general work requests; New/In progress/Done, details, priority/due date, captured linked assignees, search/paging, drag and keyboard movement, current permissions/revision/UUID recovery; 48 distinct fictional operational cards live | PR32 on main/production; exact CI and READY alias verified; additive SQL20261004114249 applied once,20 immutable migrations | All8 genuine Auth cases passed across fresh fixtures; comments, attachments, custom stages and time-off integration remain future scope |

Read [Requests contract](REQUESTS_CONTRACT.md). This custom requested board uses the shared standard desktop styling; exact current authenticated Connecteam visual parity is not established.
