# Desktop Time Off baseline

This original implementation adds full calendar-day leave requests and an audited review workflow. It preserves every applied migration and introduces no privileged application key, entitlement calculation or payroll integration. Root owns combined application/build, real Auth/browser verification, additive migration application and release.

## Official current workflow evidence

Public Connecteam Help Center guides consulted on3 October2026:

- [Starting Guide to Time Off](https://help.connecteam.com/en/articles/6713889-starting-guide-to-time-off): dashboard policy types can be paid/unpaid; admins manage requests, approvals and balances. The guide identifies sensitive personal reasons and request history as important records.
- [Time Off for Users](https://help.connecteam.com/en/articles/6758841-time-off-for-users), desktop FAQ: users open Time Off, choose Request time off, type and dates, choose all-day or specific times, optionally write a manager note, and Send for approval. This slice implements the all-day path only.
- [Creating Time Off Policies](https://help.connecteam.com/en/articles/6743822-creating-time-off-policies): distinguishes paid/unpaid policy types from employee-specific policies and limited/unlimited, fixed/hourly rules. This slice implements types, not policy entitlements or accrual rules.
- [Time Off Admins Permissions](https://help.connecteam.com/en/articles/6741264-time-off-admins-permissions): Connecteam offers configurable view/request/policy administration scopes. This baseline restricts management to owner/admin; granular permissions remain a roadmap item.

Sources were read publicly. No authenticated reference account or live Time Off records were opened or changed.

## Supported desktop/server behavior

Owners/admins create and archive leave types with a1–100 character name, description up to1,000 characters and paid flag. Names are unique among active types within a company. There are at most100 active types, so the active picker is complete and bounded; archive an unused type before adding another. Archived types are retained, prevent new requests, and preserve existing request snapshots and decisions. There is no type deletion, editing or restore in this slice.

A confirmed, nonanonymous user with current active company/membership and an active linked agent can request full calendar-day leave. The request captures the current agent ID, leave type name/description/paid snapshots, inclusive real start/end dates and an optional note up to2,000 characters. A request spans1–366 calendar days from years0001–9999. These are calendar date labels, including weekends, holidays and skipped local dates;23/25-hour DST days do not change the count. No working-day balance, entitlement, accrual, paid hours or payroll value is inferred. Past dates are allowed; no policy-specific advance-notice rule is invented.

Owners/admins review the team and approve/reject pending requests. Approval reason may be blank; rejection and cancellation require a nonblank reason up to1,000 characters. The original requester may withdraw only while pending. Owners/admins may cancel approved records. Terminal records and all prior request/decision audit events remain; there is no deletion or reopen. Each successful affected record advances its revision and has one audit event with signed actor name/server timestamp. The request history is naturally bounded to request, decision and optional cancellation.

Pending proposals may overlap. New requests cannot overlap existing approved leave, and approvals cannot overlap another approved request for the same company/agent, irrespective of leave type. Inclusive boundary dates overlap; adjacent dates do not. Writes hold a shared tenant mutex and exclusive agent mutex, while type changes hold the tenant exclusively. This serializes same-agent approvals and request/withdraw/review, agent/membership suspension and type archive checks without a client timestamp or privileged application key.

## Identity, permissions and retry recovery

Personal notes/history, withdrawals and personal receipts require both the current active linked agent and the original `requested_by` Auth user. Relinking a user from agentA toB removes personal access toA requests. A different user linked toA does not inherit the original user's private notes. Admin team authority retains old records and can reject pending/cancel approved leave after agent inactivity, requester suspension/relink or type archival. Fresh approval additionally requires the original requester still confirmed, nonanonymous, active in the company and linked to that active agent. This deliberately strengthens Time Off note privacy beyond Time Clock's agent-keyed completed history while preserving current-agent action safety.

Every change includes a mutation UUID. Receipts bind tenant, actor and exact action payload and are private. Current authorization is checked before receipt lookup. A request's captured `agentId` is checked before both first write and replay; an uncommitted retry cannot silently target a newly linked agent. Existing personal receipt replay also checks original requester/current agent and remains valid after type archive when that identity still matches. A same-actor management replay with current owner/admin authority returns the original acknowledgement without repeating a write, even if the requester later becomes inactive or the record changes. Revoked admin authority denies management replay. Reusing the UUID with another payload conflicts.

The UI must lock new writes after an uncertain response, retain only a field-free actor/company recovery marker, allow retry of the unchanged in-memory payload and require a successful fresh read before normal edits resume. Failed reads or access denial retain the lock; navigation does not store notes, dates or form values for replay. Acknowledgements bind UUID/action/target IDs/revision and are followed by a fresh snapshot.

Public tables expose SELECT only through current role-safe RLS; writes use a guarded private definer behind a signed invoker wrapper. New function ACLs explicitly revoke PUBLIC/anon/authenticated/service_role defaults before granting only intended authenticated execution. The local runner models hosted default public function grants. There is no service-role application key.

## API/read contract

`GET /api/time-off` takes tenantId and optional `view=mine|team` (defaultmine), `status=all|pending|approved|rejected|withdrawn|cancelled`, literal case-insensitive `search` up to100 characters across stored agent/type names and note, agentId/typeId filters, paired inclusive startDate/endDate filters spanning at most366 days, limit1–100 (default50), and an opaque cursor. Date filters select requests whose ranges overlap the chosen range. Team is owner/admin only; Mine filters original actor/current agent. An unlinked user receives no personal records and cannot request; current admin team/type capabilities remain available.

Counts are exact over view/search/user/type/date scope before status selection, independent of a capped directory or current result page. Stable descending keyset pagination uses `(requested_at,id)` with microseconds retained. Cursors bind company, Auth actor, current agent, role, view, every filter and timezone.

TimeOffData includes current company/role/actor/agent, active types, requests with retained snapshots and per-record capabilities/history, exact status counts, nextCursor, serverTime/timeZone and management/request capabilities. After validating the stable snapshot, the API loads a fresh signed access snapshot and withholds records if company/role/agent/timezone changed during the read. Denied current access returns403; failed recheck returns503. Authorization can change after the final check and before delivery; subsequent reads recheck and the UI must clear visible private data on scope/access changes.

`POST /api/time-off` takes `{tenantId,operationId,change}`:

- create_type: name, description, paid.
- archive_type: typeId, revision.
- request: captured agentId, typeId, startDate, endDate, note.
- withdraw: requestId, revision.
- approve/reject/cancel: requestId, revision, reason (approve omitted reason defaults to blank).

Acknowledgement is `{saved:{operationId,action,typeId,requestId?,revision}}`, with revision1 for create_type/request and inputrevision+1 otherwise. APIs use private/no-store.401/403/400/409/503 distinguish absent sign-in, denied current access, invalid inputs, stale/overlap conflicts and unknown/failed reads. Failed reads never appear as zero counts.

## Verification/release gates

- `node --test tests/config/time-off.test.mjs`: calendar/DST/skipped-date labels, explicit mutation/filter bounds, captured agent binding, cursor scope/precision, exact count/DTO validation, post-snapshot revocation/relink/role change, failure semantics and acknowledgement/retry identity.
- `node scripts/test-time-off-database.mjs`: unique disposable network-none unpublished PostgreSQL17 container; applies immutable baselines plus additive migration. Covers RLS/grants/default function ACLs, tenant/role/confirmed-user privacy, snapshots, lifecycle/audit, UUID replay/revocation/relink (including never-committed retry), archived type behavior, exact counts above1,000, bounded active type/page lists, calendar/date filters and deterministic concurrent request/approval/withdraw/suspension/archive/relink races. It cleans up only its own temporary container.
- Combined lint/type/config checks, desktop synthetic review and independent immutable review precede root's build and real Auth/browser run. No hosted release is claimed here.

Root combined acceptance passed check/build,79 combined config/query checks,97 isolated SQL/race assertions,17 synthetic desktop cases and6 fresh signed GoTrue/PostgREST/API/browser cases. Independent immutable server/UI/integration review found no blockers. The signed suite covers role/confirmation/privacy,1005 exact counts and precise pages, archived snapshots and full lifecycle/audit, UUID replay, concurrent inclusive overlap approvals, cached and never-committed old-agent retry denial, lost acknowledgement/failed recovery/exact retry and current403 UI clearing. Retained synthetic Diary/Clock/Chat rows and all non-TimeOff public tables were hashed before/after; prior populated data remained unchanged. `tests/visual-reference/time-off-integrated-desktop-review.png` is our inspected synthetic signed desktop capture.

The reviewed additive SQL was recorded once on verified hosted CT Alt as20261003234421, SHA25668e79c5518358eae48f05503137570b7bb62fc0294a8a537eb21cecb5c226c57. Recorded statements match byte-for-byte,23 existing public table counts and31 existing public/workforce_private/chat_private function definitions/owners/ACLs were retained. Three new public tables are RLS SELECT-only for authenticated, with no anonymous access or browser writes. Three new public RPCs are signed invokers with empty search paths and authenticated-only execution; anonymous/service_role execute is denied. Existing security findings are retained, with one expected INFO for private default-deny time_off_operations with no browser policies or privileges. Applied baselines are immutable. PR21 reviewed head14ed9d8375b4af147aa53b19486cd74e8ff3089a/tree19d181eca9e42a3f3e8af7d6006b57a9c6dc320a passed CI37162952970 and merged3fe6a7eca11babcf5b98946032de4cf5140afc7d. Matching productiondpl_3WQGsucDnXsZsZPj5azUzvdHGb63 is READY with ct-alt.vercel.app alias; valid unsigned API returns401/private no-store; real-account signed production acceptance remains unexercised.

## Full-parity/workforce roadmap

Granular feature permissions and policy assignments, hourly/partial-day requests, working-day/holiday schedules, limited/unlimited policies, balances/entitlements/accrual/carryover, attachments, notifications/reminders, exports, delegated approval chains, administrative creation on behalf of users, and calendar/scheduler/payroll integrations remain explicit backlog. The full workforce scope is retained; mobile is deferred under the desktop priority. No fake balance, approval success, notification, paid upgrade or outside application change is introduced.
