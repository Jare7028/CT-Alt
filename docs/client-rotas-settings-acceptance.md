# Schedule editing acceptance

This next slice is stacked on draft PR #7. It changes only the rota module, its unversioned SQL proposal and synthetic tests. Parent chooses migration versions and applies approved proposals; no hosted migration is part of this PR.

## Workflow

Company owners and admins open an active rota and choose **Settings**. The form starts with the saved name, time zone, assigned users and delegated managers. **Save settings** writes one atomic, revision-checked operation; Cancel or Escape discards unsaved input. Failed saves keep the dialog and fields visible with a readable error. After a stale revision error, cancel and use Reload before reopening settings.

The verified Connecteam references distinguish [selected-user assignment editing](https://help.connecteam.com/en/articles/6763490-edit-assignments-in-the-job-schedule), [Week and Time settings](https://help.connecteam.com/en/articles/6454016-job-scheduling-week-and-time-settings) and [administrator permissions](https://help.connecteam.com/en/articles/9667045-job-schedule-admin-permissions). This slice uses CT Alt's existing owner/admin/manager roles and individual users. Smart groups, separate permissions for editing settings and other schedule preferences remain deferred. The scoped form combines the supported fields and does not claim exact screen parity.

## Preserved commitments

- Time zone changes alter the displayed local times; stored absolute starts/ends and elapsed durations remain unchanged. This is stated in the form before saving.
- Settings never publish, unpublish, retime or remove shifts. Publish remains an explicit separate action.
- Removing an assignment with any retained draft or published shift fails atomically. Archive still preserves commitments and overlap checks across schedules.
- Existing inactive assigned users may be retained while metadata is repaired. Newly assigned users must be active and, when linked to an account, have active tenant membership.
- Existing unavailable administrator grants remain retained rather than being silently removed by the active-manager selector. They cannot bypass current membership status or role checks. Removing such grants explicitly is deferred to a later administrator UI slice.
- Only owners/admins can change these fields. A delegated manager cannot add other administrators or alter settings. Owner/admin access is inherited from the tenant and cannot be removed here.
- The company mutex, actor membership lock, delegated grant lock and target-agent/membership locks are retained. Every accepted settings mutation increments schedule revision and emits an audit record. Reads continue using the stable invoker RPC snapshot.

## Evidence

`tests/database/rota-settings.sql` verifies permission and stale-revision denials, unsupported time zones, foreign administrators, assignment removal protection, retained inactive records, newly suspended-user rejection, archive behavior, unchanged instants/publication, revision and audit behavior. `tests/database/rotas-races.mjs` uses real concurrent PostgreSQL sessions to verify settings/shift-write serialization, unchanged draft after a rejected competing write, and delegated manager revocation through the actual settings RPC.

`tests/browser/rotas.spec.ts` adds a real Auth/REST/Postgres workflow covering prefilled input, Cancel and Escape, retained-shift error, rename/time zone save, unchanged overnight draft, revocation and stale-save error followed by reload. The screenshot `docs/screenshots/rotas-settings.png` uses synthetic data only.

Local verification passed: **132 database assertions**, **19 config/time tests**, **five browser/API acceptance tests**, `npm run check`, production build and `git diff --check`. The warning-copy follow-up passed the targeted unsupported-zone browser test. All database/browser runs used disposable CT Alt loopback fixtures and synthetic records; no hosted migration, employee data or proprietary assets were used.
