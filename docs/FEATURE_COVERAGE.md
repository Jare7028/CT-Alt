# CT Alt feature coverage

Target: an independently implemented workforce app with close Connecteam feature, screen and workflow parity, using CT Alt branding. A working branch or preview does not count as a production release. Full current-reference visual parity remains unverified.

## Current production and release queue

Production commit verified at takeover: `db609caacaaf5d869add30c0c6ca56b95aa0eb49`. Vercel reports READY for this commit. Production authentication end-to-end testing has not been repeated in this session.

| Area | Implemented and tested evidence | Deployment | Remaining work |
| --- | --- | --- | --- |
| Sign-in and company access | Password and passwordless flows, confirmed identities, tenant boundaries; existing test suites | On main and production | Preserve the owner’s working login; verify delivery/configuration only when needed |
| Users/Agents | Directory, search, advanced filters, sorting, columns, add/edit, archive/restore, CSV export, add-only import, read-only profiles | On main and production | Review PR9 autosave; PR8/13 selection and visual controls; invitations, update imports, configurable fields and permissions |
| Shared navigation | Topbar, grouped sidebar, collapse, mobile dialog and keyboard checks | On main and production | Enable each real module as released; full visual reference review |
| Client Rotas | PR7 draft/publish, jobs, assignments, delegated managers, privacy and timezone tests; current integration adds shared navigation and migration alignment | Integration pending; handover records schema already applied | Verify hosted migration history; PR12 settings; open shifts, swaps, templates, repeats, requests, lifecycle and pagination |
| Chat | PR5 persistent direct/group messages, unread counts and access boundaries; PR14 group administration | Open branches; hosted migration pending | Independent final review, local acceptance, migration coordination, attachments, replies, search, moderation and Realtime |

## Wider workforce scope

These areas remain unimplemented unless a future release records specific evidence here:

- Overview and activity; global search, notifications and automations.
- Smart groups, detailed administrator permissions, organisational directory and job catalogue.
- Time clock, timesheets, attendance and payroll/reporting integrations.
- Time off, availability, open-shift requests and scheduling approval workflows.
- Updates, surveys, forms, quick tasks, contracts, knowledge bases and documents.
- Onboarding, hiring, courses, quizzes and training records.
- Events, help desk, rewards, recognition, celebrations and organisation chart.
- Employee mobile workflows, accessibility, large-directory pagination and complete visual fidelity.

## Release evidence

For every delivered slice, record functional scope, local checks, browser/API permission evidence, actual rendered desktop/mobile captures, deployed commit and hosted acceptance. Keep gaps explicit. Use synthetic fixtures and only verified CT Alt resources; all services remain free.
