# Time Clock baseline acceptance

This slice implements original CT Alt code for desktop Time Clock workflows. It does not establish full Connecteam screen or feature parity. The reviewed additive migration was applied once as `20261003215840_time_clock_baseline.sql` to verified CT Alt before releasing the consumer. Exact hosted SQL matched the repository; all16 existing public-table counts and13 prior function definitions/owners/ACLs were preserved, and all four new tables remained empty. Existing applied migrations are unchanged.

## Reference evidence

The following public official Connecteam articles were consulted for this implementation:

- [Starting Guide to the Time Clock](https://help.connecteam.com/en/articles/10086009): employees select a job when clocking in; administrators use Today and timesheets. This is the primary reference for the slice.
- [How to Set Up Breaks (Paid & Unpaid)](https://help.connecteam.com/en/articles/3016187-how-to-set-up-breaks-paid-unpaid): manual and automatic break modes, paid/unpaid classification, and deduction of unpaid break time. This slice implements manual breaks only.
- [The Time Clock's Today Tab](https://help.connecteam.com/en/articles/6198031-the-time-clock-s-today-tab): current clocked-in employees and the jobs they are working. This slice shows all open entries, including overnight entries, plus completed entries overlapping the current company calendar date.
- [The Time Clock's Timesheet Tab](https://help.connecteam.com/en/articles/9420509-the-time-clock-s-timesheet-tab): recorded worked hours and date ranges. This slice provides the signed-in user's completed records; admin timesheet editing, issues and approvals remain incomplete.
- [How to Manage Your Resources](https://help.connecteam.com/en/articles/8310516-how-to-manage-your-resources-jobs-clients-vehicles-sites) and the starting guide inform the company-job model. The linked 8529740 job article did not yield usable article content, so it is not additional evidence.

No private reference tenant was changed and no competitor assets were copied. Mobile work is deferred under the owner's desktop/functionality priority.

## Supported contract

`GET /api/time-clock?tenantId=...` returns `TimeClockData`: company metadata, current role and Auth actor ID, current linked active agent or explicit null, active jobs plus the current entry's archived job, current entry, server time and owner/admin capabilities. An unlinked owner/admin can manage jobs but cannot clock in; unlinked users can read their explicit no-agent state.

Owners/admins create and archive jobs. Active names are unique per company ignoring case/outer whitespace. Names are limited to 100 characters, and there can be at most 200 active jobs. Archived jobs are readable only where an authorized retained entry references them; entries retain their recorded job/agent names. No deletion, imports, assignments or job editing is included.

Every active linked user, including a manager, may clock in/out only for their own current agent. There can be one open entry per tenant/agent and one open paid or unpaid break per entry. Entry/break times come from the database, not the browser. Each break start/end and clock-out increments the entry revision. Clock-out ends an open break at the same server instant. Ending a break or entry remains possible after its job is archived. A maximum of 100 breaks per entry bounds read payloads.

`GET` with `mode=timesheets` returns `TimeClockEntriesData` for only the current linked agent's completed entries. Optional `startDate`/`endDate` are inclusive company-calendar dates of **entry start**, not an overlap filter; an overnight entry belongs to the date it started. `mode=attendance` is owner/admin-only and uses the current company date, including every open entry regardless of its start date. Both return `timeZone`, `serverTime`, `entries` and an opaque `nextCursor`. The page size defaults to 50 and is bounded at 100. Cursors retain timestamp microseconds and descending `(started_at,id)` order and bind tenant, actor, mode, dates, time zone and, for attendance, today's company date.

First-date-instant search handles the first midnight during Havana's rollback, 23/25-hour days, midnight gaps and skipped calendar dates. Date boundaries are computed once per read and used for start/end/Today filters. Unsupported PostgreSQL-only time zone names fail before browser rendering; reads never silently show zero records or substitute a different zone on failure.

`POST /api/time-clock` accepts `{tenantId, operationId, change}`. Actions are `create_job`, `archive_job`, `clock_in`, `clock_out`, `break_start` and `break_end`; job/entry updates require the current revision. Unknown fields, caller-supplied times/agent identities and malformed input are rejected. Successful responses contain `{saved:{operationId,action,jobId,entryId?,revision}}`; a fresh status read is required to show the current clock state.

## Authorization and recovery

All app requests use the signed user's publishable-key client. Reads use a stable invoker RPC and existing current membership/tenant checks; RLS restricts entries/breaks to the current linked agent or owner/admin, and audit reads to owner/admin. Managers cannot read team attendance or manage jobs. Public tables have SELECT-only authenticated grants; private mutation receipts are not exposed. Tenant-bound foreign keys retain job, agent, entry, membership and audit relationships.

A private bounded mutation RPC uses a tenant mutex, actor membership lock and active-agent lock to serialize clock actions, job archives and retries. Each acknowledged mutation has one audit row. Operation UUIDs bind exact normalized payload/action, tenant and actor; reusing an ID for another payload conflicts. Current authorization is checked before acknowledging a retry, including verifying that the receipt's clock entry belongs to the actor's **current** linked agent. Suspension, role revocation and relinking A to B therefore cannot recover a privileged or earlier-agent receipt. Authorized identical retries return the original acknowledgement without another write/audit.

Lost responses are uncertain outcomes. The UI retains only operation ID/action in its actor/company-scoped recovery marker, locks new changes, and can replay the same retained in-memory payload or refresh to review server state. Failed reads and access errors keep recovery locked; navigation does not retain or silently replay field values. Server idempotency is authoritative even if browser storage is unavailable.

## Verification and remaining work

`node scripts/test-time-clock-database.mjs` runs all migrations in a random, network-disabled, unpublished PostgreSQL 17 container and deletes only that owned container. SQL assertions cover grants/RLS, tenant/private reads, self-only clock actions using a known coworker UUID, server timestamps, stale revisions, paid/unpaid totals, archived-job completion, relinking/suspension before retry, date ranges, skipped dates and microsecond keysets. Real concurrent sessions cover repeated/distinct clock-ins, break start/end versus clock-out, job archive, membership/agent/company suspension and owner-role revocation before receipt replay.

`tests/config/time-clock.test.mjs` uses the real Supabase RPC builder with a synthetic fetch transport to verify request schemas, query bounds, precise cursor encoding, operation retry bodies, acknowledgement identity/revision validation, permission/read failures and unsupported browser zones. It does not count as real Auth/browser acceptance.

Final integration passed check/build,48 configuration/query tests,111 isolated Time Clock SQL/race assertions and six fresh real GoTrue/PostgREST/PostgreSQL/API/browser cases. Desktop integrated Jobs, Today, timesheets and recovery captures were inspected. Independent final API/SQL/UI/page review found no remaining blocker. Release SHA/CI/production verification is recorded by the integrator. GPS, geofences, scheduling integration, payroll, overtime, automatic breaks, approvals, manual time edits, notifications and complete feature/pixel parity remain incomplete. No hosted fixtures, application credentials or paid resources were created. The reviewed schema addition was the only hosted write. One new informational `rls_enabled_no_policy` notice concerns the private mutation-receipt table: RLS intentionally denies every direct browser read/write, with no anonymous or authenticated table grants. Mutation access stays inside the authorized private function. Existing advisory findings were retained.

Final local server/database validation passed: `npm ci`, `npm run check` (including the concurrent UI files), **41 config tests**, **111 isolated Time Clock SQL/race assertions**, and `git diff --check`. The six final real Auth/browser cases also verify archived-job completion, current suspension/relinking before receipt replay, preserved synthetic workforce/history and one committed action/audit under lost acknowledgement plus exact retry.
