# CT Alt

An independently implemented workforce application using CT Alt branding. The long-term scope is a complete workforce platform, delivered and verified module by module. Open the live app at [ct-alt.vercel.app](https://ct-alt.vercel.app).

## Current state

Released desktop modules include Users, Client Rotas, Chat and conversation search, Overview/Activity, Time Clock and team timesheets, Quick Tasks, Time Off, Updates with recipient CSV, Smart Groups/segments, and Knowledge Base. Each module has a defined implemented scope; this does not establish complete Connecteam feature or visual parity. [Feature coverage](docs/FEATURE_COVERAGE.md) records release evidence and remaining workflows. Private Knowledge Base files are the next increment in development; desktop functionality takes priority over new mobile polish.

The company-scoped Users directory provides real end-user password sign-in and: Users/Admins/Archived views, search, basic team filter, sorting, column selection, CSV export, manual add/edit and archive/restore. Managers can view the directory; only owners/admins can mutate it. Records and audit events are saved atomically through a signed-user RPC. No application service-role credential is needed.

This is an initial Users slice, not competitor feature parity. Invites, add/update and update-only imports, profile layouts, configurable permission flags/groups, role promotion/ownership transfer, deletion, last-login tracking and kiosks are not implemented. The directory loads at most 1,000 records. Owners are protected from archive; restoring a linked admin returns ordinary employee access. No invitations are sent.

The independent hosted foundation and Agents slice are live. The recorded migration versions are `20261003143058` and `20261003153745`; no remote migration is required for this Auth change. Local browser verification uses actual isolated Supabase Auth and synthetic data, not the hosted database.

The passwordless review slice adds an email link for existing users or self-signup, using the publishable client and PKCE. Password sign-in remains available. New users must confirm their email and see Company activation pending until an administrator explicitly assigns company membership. Signup never creates a tenant or grants owner access.

Email requests return the same generic result for account eligibility, delivery failures and provider rate limits, with a 60-second browser retry cooldown. Supabase remains responsible for service/per-address limits; the cookie is not a distributed anti-abuse limit. Session and PKCE cookies are HttpOnly, Secure on the hosted app, and use SameSite=Lax for email navigation. Links must be opened in the requesting browser. Invalid, expired or reused links show a generic retry message. Destinations are fixed to `/agents`; preview origins cannot request production-callback emails.

Before hosted email use, verify the independent CT Alt Auth Site URL is `https://ct-alt.vercel.app` and its redirect allowlist includes exactly `https://ct-alt.vercel.app/auth/callback`. Do not add preview wildcards. The public Auth settings expose signup/confirmation flags but not the current Site URL or redirect allowlist; those values remain unverified. No hosted Auth settings, email templates or SMTP settings have been changed and no real emails have been sent by this slice. Default Supabase email delivery has restricted recipients/quotas; actual SMTP configuration must be checked before treating it as production delivery. No paid email service is provisioned.

First-owner activation is a separate reviewed, audited transaction after verifying the intended person's Auth UUID and confirmed email. It must not depend on the first signup or user-editable metadata.

## Run locally

Use Node.js 24 and npm:

```sh
npm ci
npm run check
npm run test:config
npm run test:db
npm run build
```

The development build has a reviewed fallback containing only the verified CT Alt URL and its existing enabled publishable key. This public-by-design key grants no privileged or tenant access; end-user Auth and RLS remain mandatory. Prefer a complete environment pair: `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. Remove the development fallback when environment management is established. The URL must match the verified independent CT Alt project or its isolated local API. Partial overrides, foreign URLs and secret/service-role keys fail closed before client construction; they never fall back silently. Never use another application's URL/key, a service key or a secret key. An inherited process environment overrides `.env.local`; clear conflicting variables explicitly when starting this project.

For actual Auth/browser tests, start the isolated local Supabase stack defined by `supabase/config.toml` using Supabase CLI. Its project is `ct-alt-independent` and API port is 54821; do not reset or stop other projects. Use `SUPABASE_USE_SLIM_IMAGES=true` in limited executors. The test setup enforces this loopback project, creates only synthetic local fixtures and writes an ignored local public configuration. It never sends invitations. The passwordless tests send only synthetic emails to the isolated stack's Mailpit inbox at loopback port 54824. Local email confirmation is enabled and the exact loopback callback is allowlisted; these local settings do not change hosted Auth. A local service key is held only in the setup process; it is neither added to the app nor written to the fixture file.

```sh
# Run setup afresh before each browser suite; it restores synthetic roles.
npm run test:local:setup
# Build and run with the local configuration, clearing inherited app settings.
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm run build
env -u NEXT_PUBLIC_SUPABASE_URL -u NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY npm start
# In another terminal:
npm run test:browser
```

The setup uses `supabase` from PATH, or `CT_ALT_SUPABASE_CLI` for an explicitly chosen CLI binary. Browser tests use Chromium at `/usr/bin/chromium`, overridable with `CT_ALT_CHROMIUM`. They use plain HTTP on loopback only; no certificate validation bypass is configured. Test screenshots/results stay ignored and are not uploaded by CI.

CI runs lint, TypeScript, project-boundary assertions, isolated SQL assertions and a production build. The full local Auth/browser suite requires the explicit local stack and is not yet run in CI.

## Add-only CSV import (review slice)

Owners/admins can upload a comma-separated UTF-8 CSV, map columns to supported existing user/custom fields, inspect validation, review the summary and explicitly confirm. Preview performs no writes. Unknown columns are visibly ignored unless mapped; required company custom fields must be mapped. New custom fields, invitations, archive actions and role/access changes are not supported by import.

The parser supports a UTF-8 BOM, quoted commas/newlines, doubled quotes and CRLF/LF/CR records, and reports source lines. Invalid encoding/quoting, mismatched column counts, duplicate headers and null characters are rejected. Limits are 128 KiB per file, 25 nonblank data rows, 40 columns, 2,000 characters per decoded cell, 8 KiB per decoded row and 48 KiB for the mapped batch. Names/title/team/custom fields retain the API's own length limits. Employment dates must be finite ISO calendar dates.

Phone values normalize common formatting and use an explicit mapped/default country code for national numbers only in the supported UK, IE, US/CA, FR, DE and AU plans. Other country codes require full +/00 international format; their significant leading digits are never guessed away. Preserve phone digits as spreadsheet text; phone syntax validation does not verify real ownership or deliverability. Duplicate normalized numbers within the file block confirmation. Known existing numbers, including archived records, are shown as skipped and are never updated or restored. Preview checks the loaded directory (currently up to 1,000 records); database uniqueness is authoritative for every company record and catches unseen existing numbers or races.

All new records use one existing signed-user create batch. A conflict or server validation failure rejects the whole batch; files are never silently chunked. Confirmation success reports the acknowledged count even if the subsequent directory refresh fails. Network/unknown server outcomes block another confirmation and ask the user to inspect the directory before retrying. Formula/HTML-like text is stored as ordinary text, rendered with React escaping, and remains subject to CSV export neutralization.

This original implementation follows the documented mapping, validation, summary and confirmation sequence in [Connecteam's CSV import guide](https://help.connecteam.com/en/articles/6463571-import-users-via-an-excel-csv-file). Add/update, update-only, blank-cell overwrite policies, larger imports, inline correction and template downloads remain future increments. No hosted migration or new service is needed.

## Directory filters (review slice)

The filter panel provides quick exact-value choices and advanced field/operator/value conditions, searchable field selection under Custom fields and User details, all-condition AND or any-condition OR matching, add/remove/reset and a blue active indicator. Advanced conditions remain applied when switching to the quick view; conditions that quick mode cannot express ask the user to switch back. Incomplete/invalid conditions are visibly reported and are not applied.

Supported fields are first/last name, mobile phone, title, team, employment start date, date added, existing company custom text fields, user type and joined status. Text matching ignores case and outer whitespace; date ranges include both endpoints. Employment dates are calendar days. Date added is compared using the company's time zone; missing dates satisfy only Is empty, not date comparisons. CSV export uses all matching loaded records with the selected columns and sort, including rows beyond the current page. Search, tab and unjoined conditions still combine with filters.

Only versioned filter criteria are stored in this browser, scoped to the signed-in Auth user and company. This is not cross-device storage or smart-group creation. Saved criteria are validated against current supported fields/operators. Removed or reset restored conditions produce a persistent warning above the directory about broader results/export; Reset all acknowledges and clears it. Inaccessible company records are never supplied to this component. Filtering grants no permissions and changes no records.

The observed reference supplies quick/advanced structure and field categories; [official documentation](https://help.connecteam.com/en/articles/8715372-user-filters) confirms AND/OR, ranges, switching and filtered export. Exact text-operator labels were not captured. No screenshot pixel comparison is claimed. Groups/tags, smart groups, direct managers, email/last-login/source/onboarding and payroll fields remain tracked gaps until their underlying data and authorization exist. This slice supports up to ten flat conditions and the existing 1,000-record load limit; nested expression groups and server pagination remain future work.

## Delivery sequence

1. Verify independent repository, database/Auth and hosting resources with no paid upgrades or usage-billed provisioning.
2. Deliver the Agents module: company memberships, user/agent management and role enforcement. One person may belong to multiple companies, with a separate role in each.
3. Deliver client rotas end to end: manager planning, employee assignment, draft/publish, employee views, conflict detection and concurrent-edit protection. Test tenant isolation, time zones, DST and overnight shifts.
4. Add chat and group communication, then company updates and time-off workflows.
5. Expand the remaining workforce modules, including time tracking and knowledge management, and later training integration. These remain in scope even when lower priority.

## Isolation and public-source rules

- This project has its own release lifecycle. Do not connect it to another application's database, Auth, storage, deployment or service credentials.
- Use synthetic test data. Keep credentials, session files, real people/company records and database exports out of source, logs and CI artifacts.
- `.env.example` contains documentation only. Actual local environment files and provider bindings are ignored.
- No existing application source, branding, proprietary documents or migration history has been imported.
- Hosted runtime configuration and each migration remain separate reviewed setup steps. Do not provision paid resources or enable billing automatically.

CI uses a standard Ubuntu runner for this public repository, with no uploaded artifacts or persistent cache. It has read-only repository permissions and no deployment steps or provider secrets.

Public visibility does not choose an open-source license. No license grant is added by this scaffold; dependency licenses remain their respective authors'.

## Database foundation and Agents migration

`supabase/migrations/20261003143058_workforce_foundation.sql` creates only `tenants`, `tenant_memberships`, RLS policies and internal helpers. Roles are owner, admin, manager and employee. Active members can read their companies; employees can read only their own membership; managers/admins/owners can read their company's directory. Suspended companies/memberships, anonymous Auth users and unconfirmed identities have no access. User-editable metadata cannot grant access.

Browser roles cannot create or mutate tenants/memberships. No signup hook, invitation delivery, global-admin role, application service credential or account-provisioning RPC is included. Those later operations need tested server authorization and audit handling. The Agents record RPC is added by the second migration.

The privileged service role bypasses RLS. Never expose it to browsers, and never use it for ordinary user reads. Future scheduling records should use composite tenant-bound foreign keys to memberships; application filtering alone is insufficient.

Run the database assertions with Docker:

```sh
npm run test:db
```

The runner creates its own temporary PostgreSQL 17 container with no network, no exposed ports and synthetic fixtures, then removes that container. It accepts no database URL and never uses the connected Supabase project. The image is pinned by digest. The tests emulate only the minimal Supabase Auth schema/identity contract; they do not test actual sessions, PostgREST, email or hosted configuration.

Before remote application, verify the intended independent project's identity and Free plan, inspect its schema/history for conflicts, and apply through the parent-controlled migration process. This repository has no automated remote migration or deployment step. `tests/database/bootstrap.sql` is local-only and must never be applied to a hosted project. Configure exposed API schemas to exclude `workforce_private`, and run hosted read-only policy/advisor checks after application.

## Read-only Agent profiles

User names open addressable `/agents/{id}?company={companyId}` pages. When the First name column is hidden, a View link remains in the row. Profiles show existing user/custom fields, record timestamps in the company time zone, calendar-only employment date and linked company membership status/access. They do not infer an email, invitation state, last login or photograph. Owners/admins can edit active profiles inline or use the existing Users directory edit dialog.

Every profile read uses the authenticated user and existing RLS, with explicit company filters. Owners/admins/managers can read their company records, including archived records. Employees can read only their own linked active record; another employee's membership and the creator's identity remain hidden by RLS. Unknown, malformed, foreign-company and unauthorized records use the same unavailable page. No schema, permission grant, privileged credential or write endpoint is added.

`tests/visual-reference/current-users-desktop.png` is our own isolated local app output at 1184 × 1000 using synthetic fixtures only. It contains no credentials, real workforce data, source competitor image or browser chrome. This manually reviewed artifact supports visual comparison; it is not an automatic screenshot assertion or a claim of competitor pixel parity.

## Directory selection and controls

The unjoined pill counts active records without a linked account in the loaded company directory. No seat-capacity denominator is invented. Header select-all selects only the current page; row selection persists across pagination and sorting. Export uses selected matching rows when any are selected, and otherwise all matching loaded rows. Search, filter, tab, unjoined and data-refresh changes clear selection; company/account switches remount the directory. Selection never changes membership or records.

Toolbar styling follows the parent's native visual review of the private source crop: counted outlined unjoined pill, filter/search icons, circular export, selection gutter, tab underline, primary blue and header styling. Our own desktop reference uses an approximately 1,084-pixel card width; `tests/visual-reference/current-users-controls.png` captures only our rendered tabs, toolbar and header. Source zoom/DPR is unknown and full pixel parity is not claimed.

## Profile editing

Owners/admins can click an existing field on an active profile, edit it inline and save by leaving the field. This follows the blur-save interaction documented in [Connecteam's profile guide](https://help.connecteam.com/en/articles/8934869-managing-your-users-profiles). Personal details contain names/mobile; Company related info contains title/team, calendar employment date and existing configured custom text fields. Saved, Saving, Editing and error states remain visible. Directory manual add/edit keeps its separate explicit confirmation workflow.

Invalid input never submits. Escape discards only the current unsaved field and restores keyboard focus; it does not undo earlier saves. Saves are serialized and submit one existing signed-user update with the last confirmed revision. A successful acknowledgement must identify the same record and its next revision. Stale/unknown outcomes preserve the field and block further writes until a fresh read. Record/company/linked-account identity, roles/access, status and audit metadata are not editable. Archived profiles require the existing directory restore workflow first.

Profile links wait for acknowledgement before navigating. Browser Back cannot reliably be cancelled, so pending saves use keepalive and an outcome marker scoped to the Auth user, company and record. The marker contains only status and revision, never field values or credentials. A subsequent visit requires review if its outcome is unknown or its cached record predates a confirmed save. Hard unload uses the browser's unsaved-change warning. These browser recovery paths were verified in local Chromium; browser policy and session-storage availability can limit recovery. The database's revision and authorization checks always remain authoritative. No schema or permission grants change.


## Chat and group permissions

The integrated Chat branch includes company-scoped direct and selected-user group conversations, text history, unread counts, earlier-history pagination and retry-safe sends. Chat Info supports member selection, explicit group admins and admin-only posting with revision conflicts and audit records. The existing shared shell contains Chat's company selector and tenant-aware Users navigation. Live company/group membership and posting checks remain enforced in PostgreSQL.

Both reviewed Chat migrations have been applied once to CT Alt, and shared module links are enabled. Local checks cover tenant isolation, current-role revocation, concurrent changes and stale client responses; authenticated hosted acceptance and full appearance parity remain unverified. See [Chat review and integration](docs/CHAT_REVIEW.md) for verification and the complete remaining feature scope.
## Client Rotas integration

The integration branch adds named schedules, selected Agents, manager delegation, coloured jobs, draft shifts and explicit publication. Day/Week/Month boards show elapsed hours across overnight and daylight-saving changes. Employees can read only their own published shifts. Users and Agent profiles link to Client Rotas through the shared desktop/mobile shell.

The migration `20261003191154_client_rotas` is registered using the exact SQL recorded as already applied in [the takeover handover](docs/CODEX_HANDOVER.md). Local runners apply migration history once. Do not replay it against hosted Supabase. Hosted history now matches the repository exactly and scheduling is deployed in production; real-account authenticated production acceptance remains unverified. Run `npm run test:rotas:db` and the disposable fixture/browser acceptance in [the coverage notes](docs/client-rotas-acceptance.md).

The target remains full Connecteam feature and screen coverage, delivered module by module. See [feature coverage](docs/FEATURE_COVERAGE.md) for the distinction between existing production features, locally implemented work and remaining scope.

## Overview and Activity

Overview shows signed-user workforce counts and recent owner/admin user-change activity; Activity supports company-calendar filters and stable older-history pagination. Managers see counts without audit data; employees and foreign/revoked memberships are denied. See [Overview review](docs/OVERVIEW_REVIEW.md) and run `node scripts/test-overview-integration.mjs` for isolated real Auth acceptance. All summary counts use one signed-user statement snapshot with existing RLS and current access checks.

## Time Clock

Desktop Time Clock supports jobs, personal clock-in/out, paid/unpaid manual breaks, own completed timesheets and owner/admin Today attendance. Server-recorded times, current linked-user authorization, revisions and operation UUIDs protect writes and recovery. See [Time Clock acceptance](docs/time-clock-acceptance.md); run `node scripts/test-time-clock-integration.mjs` for real isolated Auth/API/browser checks. Payroll, approvals, editing, GPS/geofencing and automatic breaks remain future work.

## Quick Tasks

Quick Tasks supports owner/admin drafts, publishing, edits, archive/restore and reopening; assigned users complete published work. Shared group tasks have one completion, while separate-per-user tasks remain independent. Desktop status/search/overdue filters, precise paging, exact counts and bounded searched assignee selection are available. See [Quick Tasks acceptance](docs/quick-tasks-acceptance.md); run `node scripts/test-quick-tasks-integration.mjs` for isolated real Auth acceptance. Comments, attachments, subtasks, recurring work and granular feature permissions remain further work.

## Team timesheets

Owners/admins can review completed team time entries with inclusive company-calendar dates, retained user names, exact range totals and precise paging. Complete CSV uses the whole selected date/user scope, independently of displayed pages, and refuses scopes above10,000 entries. See [Team timesheets acceptance](docs/team-timesheets-acceptance.md); run `node scripts/test-team-timesheets-integration.mjs` for isolated real Auth/browser checks. Payroll, manual edits, approvals and full Time Clock parity remain further work.

## Conversation message search

Desktop Chat can search literal message text within a currently joined conversation, with exact counts and precise paged sequences. Search pauses read marking; Clear resumes normal Chat. Current actor/company/conversation checks preserve private groups and revoke access on subsequent reads. See [search acceptance](docs/chat-search-acceptance.md). Global search, attachments and full Chat parity remain further work.

## Time Off

Active linked users can request full calendar-day leave and withdraw pending requests. Owners/admins create/archive leave types and review, approve, reject or cancel team requests with retained history, exact filters/counts and safe retries. See [Time Off acceptance](docs/time-off-acceptance.md). Partial-day leave, policy balances/accrual and calendar/payroll integration remain further work.

## Updates

Owners/admins can draft and publish plain text updates to 1–500 selected company members, then archive or restore them. Recipients can open updates, separately confirm reading when requested, react and create/edit/remove their own comments. Management tracks exact viewed/confirmed counts and paged recipient statuses. Publishing freezes content, recipients and engagement settings. See [Updates acceptance](docs/updates-acceptance.md); run `node scripts/test-updates-integration.mjs` for isolated real Auth/API/browser checks. The reviewed additive database migration and PR22 consumer are verified on matching READY production. Rich media, Smart Groups, scheduled publishing, user posting, notifications and full reference parity remain further work.

## Updates recipient export

The owner/admin recipient-status panel can export every matching recipient as a formula-safe UTF8 CSV, independently of displayed pages. It includes retained names/IDs and distinct first-view/read-confirmation statuses with precise UTC timestamps; confirmation disabled is labeled Not required. The selected status filter applies to the whole fixed audience, up to500 recipients. See [export acceptance](docs/updates-export-acceptance.md). Reviewed SQL and PR23 are verified on matching READY production. Grouped/custom exports and granular asset permissions remain further work.

## Smart Groups and segments

Owners/admins can organize active workforce records into segments and save dynamic, case-sensitive profile rules with matching previews and searched member pages. Counts distinguish matching records from linked eligible accounts; groups grant no account access or content assignments. Invalid removed fields require repair, and archive/restore retains history. See [Smart Groups acceptance](docs/smart-groups-acceptance.md) and [desktop UI review](docs/SMART_GROUPS_UI_REVIEW.md). Reviewed additive SQL and PR24 consumer are verified on matching READY production. Protected account groups, typed/date rules, granular administrators, Users Save as Group and dynamic feature assignments remain further increments.

## Desktop Knowledge Base

Desktop bases, nested folders, plain text, named links, persistent sibling ordering, fixed Auth audiences, reader access and genuine open-event insights are implemented using [Connecteam reference findings](docs/knowledge-base-reference.md) and [the reviewed contract](docs/KNOWLEDGE_BASE_CONTRACT.md). The implementation passed full check/build,119 combined configuration checks,94 isolated SQL/race/preservation assertions,57 synthetic desktop cases and8 fresh real local Auth/API/browser cases (2.9 minutes). The reviewed schema is registered as20261004034015 and was applied once; PR25 passed exact-head CI37175077530 and is verified on matching READY production. Private files, rich text, dynamic group assignments, granular administrators and further workflows remain planned.
