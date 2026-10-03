# CT Alt

An independently implemented workforce application. Agents and their access permissions come first, followed by client rotas and team communication. The long-term scope is a complete workforce platform, delivered and verified module by module.

## Current state

The live first slice provides real end-user password sign-in and a company-scoped Users directory: Users/Admins/Archived views, search, basic team filter, sorting, column selection, CSV export, manual add/edit and archive/restore. Managers can view the directory; only owners/admins can mutate it. Records and audit events are saved atomically through a signed-user RPC. No application service-role credential is needed.

This is an initial Users slice, not competitor feature parity. Invites, imports, profile layouts, configurable permission flags/groups, role promotion/ownership transfer, deletion, last-login tracking and kiosks are not implemented. The directory loads at most 1,000 records. Owners are protected from archive; restoring a linked admin returns ordinary employee access. No invitations are sent.

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

User names open addressable `/agents/{id}?company={companyId}` pages. When the First name column is hidden, a View link remains in the row. Profiles show existing user/custom fields, record timestamps in the company time zone, calendar-only employment date and linked company membership status/access. They do not infer an email, invitation state, last login or photograph. Editing remains in the Users directory.

Every profile read uses the authenticated user and existing RLS, with explicit company filters. Owners/admins/managers can read their company records, including archived records. Employees can read only their own linked active record; another employee's membership and the creator's identity remain hidden by RLS. Unknown, malformed, foreign-company and unauthorized records use the same unavailable page. No schema, permission grant, privileged credential or write endpoint is added.

`tests/visual-reference/current-users-desktop.png` is our own isolated local app output at 1440 × 1000 using synthetic fixtures only. It contains no credentials, real workforce data, source competitor image or browser chrome. This manually reviewed artifact supports visual comparison; it is not an automatic screenshot assertion or a claim of competitor pixel parity.
