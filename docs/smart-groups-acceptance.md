# Desktop Smart Groups server acceptance

This original CT Alt module implements mandatory segments and dynamic organizational groups over company-scoped Agent workforce record IDs. Current confirmed, nonanonymous, active company owners/admins can read and manage it. It adds no account, directory, Chat, Updates or other feature permissions. Managers/employees cannot read group metadata, member previews or mutate groups.

## Reference and deliberate boundaries

Public official guides inspected on4 October2026:

- https://help.connecteam.com/en/articles/6114686-smart-groups-and-segments — segments, profile-rule dynamic membership, exact case-sensitive filters, preview, administrator selection.
- https://help.connecteam.com/en/articles/6847572-how-to-create-a-smart-group-from-the-user-s-tab — filter preview, Save as group and group search.
- https://help.connecteam.com/en/articles/9532107-a-quick-way-to-create-a-smart-group — creation from Users/profile management.
- https://help.connecteam.com/en/articles/7159933-i-created-a-smart-group-but-it-contains-all-my-users-where-did-i-go-wrong — unfiltered group includes everybody, protected defaults.
- https://help.connecteam.com/en/articles/8061578-troubleshooting-smart-groups-i-m-having-difficulty-adding-a-user-to-a-smart-group — case sensitivity and deleted/recreated dropdown option identity.
- https://help.connecteam.com/en/articles/8061301-why-can-t-i-delete-the-all-users-smart-group — protected account-based All Users/All Admins.
- https://help.connecteam.com/en/articles/8069531-can-all-admins-create-smart-groups — configurable feature/create permissions.
- https://help.connecteam.com/en/articles/7159798-can-i-delete-a-smart-group-if-i-delete-old-smart-groups-will-any-information-be-lost — reference deletion and assignment effects.

Cached public prose/screenshots and the evidence-versus-uncertainty memo remain outside Git at `/tmp/ct-alt-smart-groups-research.md`. No competitor assets or workforce information are incorporated. Archive/restore is explicitly a CT Alt retention extension; deletion and its reference assignment fallback are not implemented. Group membership never grants account access or reassigns existing fixed audiences.

## Implemented behavior

Segments and groups support create, edit, move (group edit changes parent), archive and restore. Revisioned mutations write one audit and an actor/company/UUID payload-bound private receipt atomically. A short tenant advisory mutex serializes parent lifecycle/group writes. Current company/Auth/membership rows are locked and current owner/admin authority is checked before any old receipt lookup. A currently authorized owner/admin may receive the original acknowledgement after later field/lifecycle changes; this repeats no write.

Active groups block parent-segment archive. Group create/edit/restore requires an active parent, including repair of an archived group. Invalid retained groups can be archived and repaired, but cannot restore until valid. There are no cascades or deletes.

Rules contain1–10 AND clauses. A clause is `{field,values}`, where field is title, team or a currently registered `custom:key`; its1–25 distinct literal alternatives use exact case-sensitive OR matching. Missing/empty profile values never match. Meaningful leading/trailing alternative spaces remain unchanged; whitespace-only values, unknown fields, arbitrary paths/operators, nested/global OR and zero-rule broadcasts are rejected. Names≤100, descriptions≤500 and alternatives≤500 UTF16 input units are enforced both in API and direct signed RPCs. Mutation/preview JSON bodies are limited to40KiB at the endpoint; SQL also bounds mutation JSON. Names are trimmed; descriptions/rule alternatives are preserved.

Matching includes active Agent records with no linked Auth user and excludes archived records. Exact counts satisfy `records = unlinked + eligible + unavailable`. Eligibility is separately current linked company membership active plus Auth confirmed/nonanonymous. Suspended, unconfirmed or anonymous linked records remain organizational matches but unavailable for communication. The private Auth helper returns only record ID/boolean eligibility under current owner/admin access; no email, contacts, Auth metadata or linked user ID is returned. Agent relinking does not transfer communication identity/history or receipt ownership. Accounts without Agent records are absent from this population.

A removed custom key returns `needsReview`, explicit `invalidFields`, null counts and no member page, rather than broadening membership. New saves/previews reject unknown fields. Current field keys are the existing identity; future typed/editable fields need stable identities before key reuse.

## Reads, pagination and API

GET `/api/smart-groups` accepts tenantId, status(active default/all/archived), optional segmentId, literal search, limit and opaque cursor. GET `/segments` defaults to all statuses for segment selection/recovery. GET `/[id]/members` returns the exact saved group/parent definition, fields, full population counts, search-matched count and bounded records. POST `/preview` accepts tenantId/rules/search?/limit?/cursor? and returns the echoed rules with matching population/page. POST the base route accepts `{tenantId,operationId,change}` and returns `{saved}`.

Read replies contain current tenant/actor/owner-admin role, fieldFingerprint, datasetVersion and serverTime. Lists default50/max100; search≤100 characters is literal case-insensitive substring search, separate from case-sensitive membership rules. Exact counts are calculated over the complete population, not a directory1000-row result. Status catalog counts are measured before the chosen status filter; member search does not change full population counts.

One STABLE SECURITY INVOKER RPC snapshot supplies definition/fields/eligibility/counts/page. Cursor scope binds tenant, actor, role, kind, group, parent filter, status, literal search, field fingerprint, rules fingerprint, saved revision and evaluated population version. SQL lower(name)/UUID keysets retain their opaque SQL position; JavaScript never recomputes Unicode folding. Fingerprints avoid copying up to40KiB rules into continuation cursors. Current active profile identity/name/rule values/link/eligibility and group/segment revisions participate in datasetVersion; changes invalidate continuation with409. Conservative whole-company invalidation also occurs for unrelated organizational changes.

Before returning any snapshot, another signed invoker access RPC rechecks current actor/role/company, returned group/segment revisions/status and both fingerprints. Access loss returns403; population/schema/lifecycle change409; validation400; sign-in401; malformed/read failure503; oversized JSON413. No apparent empty success is returned on failures. Reads/preview never write audits, receipts, membership or view marks. The final recheck is a boundary, not an atomic guarantee against changes committed after that check; the next request rechecks again.

Public new tables have authenticated SELECT-only RLS. New public RPCs are invokers with empty search paths. Every new function explicitly revokes PUBLIC/anon/authenticated/service_role default EXECUTE before intended authenticated grants. Private mutations/eligibility helpers use intentional empty-path definers; private receipts are default-deny. No applied baseline is modified.

## Local verification and integration needs

Run `node --test tests/config/smart-groups.test.mjs` and `node scripts/test-smart-groups-database.mjs`. The SQL runner owns a unique digest-pinned PostgreSQL17 container with network none, no published ports and tmpfs data, and removes only that container. It models permissive public table/function defaults, applies all existing migrations, populates retained Updates/Agent data, and compares all legacy public/workforce_private/chat_private table row counts/digests and function definitions/owners/ACL/config before/after the candidate and tests.

Config cases cover strict queries/rules, exact count shape and arithmetic, field/population integrity, current-role/access failures, opaque Unicode cursor positions, malformed snapshots and precise acknowledgements. SQL cases cover >1000 counts, eligibility partition, exact AND/OR/case/space rules, missing fields, UTF16/JS-whitespace direct RPC bounds, paging/schema/version conflicts, lifecycle/repair/receipt/current-auth/tenant/RLS/ACL boundaries. Actual concurrent transactions cover same UUID one audit, competing parent archive/group create and a held STABLE preview coherent with its snapshot followed by changed fresh population detection.

Combined check/build and108 configuration cases passed. Integrator reran59 isolated SQL/race/preservation assertions plus122 retained Updates and24 recipient-export assertions with this module installed. All47 synthetic desktop cases and8 fresh real local Auth/PostgREST/API/Chromium cases passed1.3minutes, covering current owner/admin/tenant/Auth permissions,1005 records with11 precise pages, literal Unicode rules/search, missing-field repair and parent lifecycle, current-role receipt denial, Agent relink communication retention, held snapshots with fresh field/access denial, actual desktop CRUD/previews, current403 private clearing, lost acknowledgement/failed recovery/exact retry and decoded-ACK departure. A test-only correction5a087884 fixes the existing Chat search parameter, preserving its expected200/assertions without application changes. Owned local services/ports/private fixture files were cleaned/restored.

Independent immutable server8095cc682e67985164421ac6781f61d056a92586 and UI348e26a3cd87e9f9e74aa54d28c3729730f9ea9e reviews found no blockers. Root inspected tests/visual-reference/smart-groups-integrated-desktop-review.png and its1444×960 viewport, containing only synthetic signed records.

Reviewed SQL was applied once to verified CT Alt and recorded as20261004014158_smart_groups.sql, exact SHA2564259592660bac2d4e8f5ece8ab0b29f72c4000c158143a756a8a5f47c477d2d1. All15 earlier statements still match repository bytes;34 previous tables across public/workforce_private/chat_private retained counts and47 previous functions retained definition/owner/ACL/config. Three new public tables have SELECT-only signed RLS/no browser writes; three public RPCs are empty-path authenticated-only invokers with no anon/service-role execute. One new private receipt INFO is intentional default-deny; existing security advisories remain unchanged. The previously unapplied CLI filename was matched to the server-assigned version without modifying SQL.

Final fresh eight-case signed acceptance additionally verifies direct manager/employee/foreign page denial with no private group names, mutation controls or member/preview panes. Test-only e2b9b678/0e55ca7 add those assertions and scope the denial alert to the rendered main rather than the framework route announcer. All8 cases passed1.3minutes; recorded-order SQL59 recheck passed. Consumer PR/exact-head CI/merge/matching production remain pending. Real-account authenticated hosted production acceptance is not established by these local tests.

## Full remaining module scope

Protected account-based All Users/All Admins, typed dropdown option identities, date/birthday/relative calendar rules, richer operators and verified nested rule semantics, automatic groups/segments, Users Save as group, profile membership views, account-only population semantics, granular feature/create/group-admin delegation, managed-user/Direct Manager permissions, asset assignments, dynamic cross-module audiences, reference deletion/fallback, exports/notifications and other reference workflows remain future increments. Mobile work is deferred under the desktop-priority direction. This baseline does not claim full Connecteam parity.
