# Schedule editing acceptance

This slice is integrated with the updated Client Rotas baseline and shared shell. The already-applied `20261003191154_client_rotas.sql` migration and original SQL proposal remain byte-for-byte unchanged. The separately generated `20261003210226_client_rota_schedule_settings.sql` migration widens the audit action CHECK and replaces only `workforce_private.save_rota` to add `update_schedule`, preserving ownership, SECURITY DEFINER, empty search path and existing execute grants. The reviewed additive SQL was applied once to hosted CT Alt through the Supabase migration endpoint, which recorded version 20261003210226. The repository filename now matches that actual recorded version; SQL content is unchanged. The prior applied baseline was not replayed.

## Workflow

Company owners and admins open an active rota and choose **Settings**. The form starts with the saved name, time zone, assigned users and delegated managers. **Save settings** writes one atomic, revision-checked operation; Cancel or Escape discards unsaved input. Rejected saves keep the dialog and fields visible with a readable error. A lost response locks the settings form and cancellation until Reload and review reads the latest saved schedules; the shared write lock prevents duplicate submissions. After a stale revision error, cancel and use Reload before reopening settings.

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

Original PR12 verification reported: **132 database assertions**, **19 config/time tests**, **five browser/API acceptance tests**, `npm run check`, production build and `git diff --check`. The warning-copy follow-up passed the targeted unsupported-zone browser test. All database/browser runs used disposable CT Alt loopback fixtures and synthetic records; no hosted migration, employee data or proprietary assets were used.

## Integration verification

The rota database runner executes the baseline suite before applying the additive settings migration. It compares every retained rota record and both mutation functions' identity, owner, ACL, SECURITY DEFINER/invoker and search path before/after the upgrade, then executes the settings and concurrency suites. The new real-browser regression covers an acknowledged settings update followed by a committed update whose response is discarded, blocked retry/cancellation, a failed review read that retains the lock, and a successful review showing the persisted settings/revision. The integration owner ran all seven scheduling Auth/API/browser cases successfully on a fresh disposable local stack, including both baseline recovery and settings recovery regressions.

Local integration checks passed: `npm run check`, **32 config tests**, **134 rota database assertions** (including populated upgrade preservation), **153 foundation/Agents assertions**, production build and `git diff --check`. All seven real local Auth/API/browser cases passed. Hosted history now matches the reviewed SQL exactly; before/after retained row counts are unchanged. Hosted permission/function checks pass. Real-account production Auth acceptance remains unverified.
