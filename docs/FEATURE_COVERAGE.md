# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Latest application release: `88997f4b2b92ef44b3995de3b21224b5f3f01deb`. Vercel production `dpl_BpKqzsLrkDHNBVnujdZDAVSDgR41` is READY and aliased to ct-alt.vercel.app. Live login renders; unauthenticated Agents/Time Clock/Quick Tasks redirect to login. Real-account authenticated production workflows were not exercised.

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
| Knowledge Base | Desktop multiple bases/nested folders/plain text/links, fixed Auth assignment, moves/order/title search, explicit reader views and genuine insights;119 configs,94 SQL/races,57 synthetic and8 real local Auth/API/browser cases | On main and production; PR25 CI37175077530 passed | Private files, rich text, dynamic groups, granular administrators, export and complete reference workflows |

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

Work underway: Smart Groups/segments PR24 is verified on matching READY production. Its reviewed head0e55efde413400f33ed8262a5b2daecf09e899db/treea182c092142ac640b27c810b91f75c6e37b2947c passed exact-head CI37169681084 and merged c0401691aab4f6a9874fd937f3a4e171704908c8. Login200, Smart Groups307-to-login and three valid unsigned API queries401/private-no-store passed. Real-account authenticated hosted workflows remain unverified. Knowledge Base PR25 reviewed headc207e1491d7b2b6615d4e77d66cc8e533921e432/tree0bb267b09ab8bbc706a56b3767eaf1d75c89a7a7 passed exact-head CI37175077530 and merged 88997f4b2b92ef44b3995de3b21224b5f3f01deb. Matching productiondpl_BpKqzsLrkDHNBVnujdZDAVSDgR41 is READY/aliased. Login200, Knowledge Base307-to-login and four valid unsigned APIs401/private-no-store passed. Private file work continues in /workspace/ct-alt-knowledge-base-files under [its contract](KNOWLEDGE_BASE_FILES_CONTRACT.md), using [official reference findings](knowledge-base-reference.md). Its initial desktop increment is not full parity or the project endpoint. Preserve the wider roadmap.


Private Knowledge Base files are locally accepted under [file acceptance](knowledge-base-files-acceptance.md):43 genuine Storage/SQL/race checks,117 persistent synthetic cases and9 fresh signed Auth/API/browser cases passed;128 configs and check/build passed. The file schema, bucket and verifier settings are not hosted yet, and code is not a production release. Secure Vercel authentication is required for its server-only verifier environment settings. Desktop Forms proceeds independently from PR25 under docs/FORMS_CONTRACT.md in /workspace/ct-alt-forms; no Forms release or hosted schema is claimed.
