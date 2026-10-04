# Fictional workspace content

On 4 October 2026 the owner authorised fictional workforce content in CT Alt and subsequently requested natural names and a more realistic, usable workspace. That instruction supersedes the original requirement for visible `[DEMO v1]` labels. All staff and operational examples remain fictional; no real workforce data was imported.

The original seed was committed atomically and replayed without duplicates. The Requests board and its 48 cards are also live: application main `de023f0edb6db888062661c59bdbcd5e4c83dec8`, passing CI `37200205189`, matches READY production `dpl_CrievaTxw817FiZHhz25Pe9LHJgt` at https://ct-alt.vercel.app. The 20 registered migrations remain immutable.

## Current content

| Area | Verified live content |
| --- | --- |
| Directory | 21 naturally named fictional profiles with credible titles and teams |
| Scheduling | 3 schedules, 6 jobs and 60 published four-hour shifts; names and shift labels updated |
| Time Clock | 6 naturally named jobs; no invented working-time history |
| Quick Tasks | 12 practical tasks with useful instructions; existing dates, assignments and publication states retained |
| Requests | 48 unique site-specific titles and descriptions: 24 New, 12 In progress, 12 Done |
| Updates | 4 published announcements and 2 drafts with original, practical content |
| Knowledge Base | 2 published handbooks, each with 1 folder and 2 useful text guides |
| Forms | Published Daily shift check and Equipment inspection forms with meaningful descriptions and question labels |

Twenty staff profiles remain directory-only. The owner-linked fictional profile is Alex Morgan, Operations coordinator. Its existing account link is retained; the owner's Auth identity, display name, login, role and settings were not changed. The application still permits only eligible linked accounts to receive Requests and Quick Tasks assignments. No staff accounts, invitations, messages, notifications, clock history, form submissions or engagement events were invented.

## Data update and evidence

The content correction passed a rollback-only transaction before the identical proposal was committed to the verified CT Alt project `clytszmnrssgvnlwfbrm`, company `9a221914-d01b-44a1-9eed-c0c432619701`. Complete before-row comparisons bind every update to an exact existing seed ID and abort if it changed. Existing audited RPCs handle directory, schedule settings, task, request, update, handbook/node and form edits and publication. Job names and already-published shift labels have no rename RPC, so the reviewed proposal corrects only their exact existing IDs and label/revision columns; it preserves dates, assignments, status and historical events.

Transaction assertions compare every original row across public, workforce_private, Auth and migration tables. Only the specified content/revision/publication fields and the linked task assignee's captured name may change. Row counts, including initially empty tables, allow only the expected new audit/receipt rows. Existing function, relation, RLS-policy and trigger metadata is retained. No permanent helper objects or schema changes were made. Rollback validation may consume ordinary audit sequence values; existing audit rows remain unchanged.

Post-commit checks found zero placeholder wording in current directory, schedules/jobs/shifts, tasks/assignee names, Requests, Updates, handbooks/nodes or forms/questions. Database reads under the authenticated owner role returned all 21 profiles, the exact Requests counts, four published Updates, two published handbooks and two published forms. This is database-role/RPC evidence, not a new browser login or a captured authenticated UI session. Production smoke checks: login 200, unsigned Requests API 401, directory 307 to login. A second use of the old proposal failed its exact-row guard before any content changes; records were neither duplicated nor reset.

The preparation-only [script](../scripts/prepare-workspace-content.mjs) does not connect to services. It takes a private snapshot and produces rollback SQL by default. It is specific to the original seed; never use it as a recurring reset or apply it as a schema migration. The private snapshots and generated SQL remain outside this public repository. Four new configuration tests cover wrong-company/missing/duplicate rows, edited-seed refusal, preserved identities/dates/access and rollback/CAS guards. All 190 configuration tests, `npm run check` and the production build passed. Independent review found no remaining blocker.

Other projects, deployment settings, database connections, Auth configuration and billing were untouched. Further feature parity work remains tracked in [FEATURE_COVERAGE.md](FEATURE_COVERAGE.md).
