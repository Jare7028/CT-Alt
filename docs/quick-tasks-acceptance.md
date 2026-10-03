# Desktop Quick Tasks acceptance

This additive slice implements original application code informed by public Connecteam help articles. It is a baseline toward the full workforce scope, not a claim of full Connecteam parity. It has no hosted execution requirement built into its tests and contains only synthetic data.

## Official workflow evidence

Public Connecteam Help Center articles consulted:

- [Quick Tasks starting guide](https://help.connecteam.com/en/articles/6690969-quick-tasks-starting-guide): task creation, assignment, deadline and task views.
- [Viewing capabilities](https://help.connecteam.com/en/articles/4329770-quick-tasks-viewing-capabilities): All Tasks, My Tasks and tasks created by the user.
- [Quick Tasks for users](https://help.connecteam.com/en/articles/6451974-quick-tasks-for-users): assigned-task detail and completion.
- [Group tasks](https://help.connecteam.com/en/articles/8527883-group-tasks): one shared task that an assignee can complete for the group.
- [Must-have capabilities](https://help.connecteam.com/en/articles/6453340-quick-tasks-must-have-capabilities): separate tasks for each user, giving each an independent completion.
- [Admin permissions](https://help.connecteam.com/en/articles/9419492-quick-tasks-admin-permissions) and [user permissions](https://help.connecteam.com/en/articles/6474658-quick-tasks-user-permissions): broader configurable permissions remain a backlog item; baseline creation is owner/admin only.
- [Archive or delete tasks](https://help.connecteam.com/en/articles/8742132-how-to-archive-or-delete-quick-tasks): archive and restore preserve records; destructive deletion is deliberately outside this slice.
- [Descriptions and comment board](https://help.connecteam.com/en/articles/6474694-quick-tasks-task-description-and-comment-board) and [labels](https://help.connecteam.com/en/articles/4329863-quick-tasks-labels): plain description is supported; comments, attachments and labels remain backlog.

## Supported server behavior

Owners/admins create draft or published tasks, edit metadata/assignees, publish, complete, reopen, archive and restore. Managers/employees read and complete only their own published, unarchived assignments through a current active linked agent. Owners/admins may complete a task they manage. Capabilities are computed by the server; client role visibility is not authorization.

Group mode creates one task and one shared completion state for up to25 active linked assignees. Separate mode atomically creates one task row per assignee, each with its own revision, assignment and completion. Subsequent edits to an individual task retain exactly one assignee. Mode is immutable. Completion records the signed actor and server time. Archived tasks retain their completion and assignment records and must be restored before further changes.

Titles are1–150 trimmed characters; plain descriptions are at most5,000 characters. Start/deadline fields are optional real calendar dates from0001 through9999; start cannot be after deadline. A deadline includes the entire company calendar date. Overdue compares the company's current local date with the stored due date, avoiding ambiguous midnight conversion and24-hour arithmetic. Open, published, active tasks alone count as overdue. Start date is descriptive scheduling information; it does not conceal a published task or prohibit early completion.

All mutation actions use revision checks except creation. Every successful affected row has one audit event. UUID retries are bound to tenant, actor and exact action payload. Current company, membership and task/assignment authorization is checked before a cached acknowledgement is returned. For owner/admin creation replay, the current admin role authorizes access to the original receipt even if a previously selected assignee has since become inactive; replay creates no new task. Revocation of that admin role denies replay. Non-admin completion replay additionally requires the current active linked assignment. A reused UUID with another payload conflicts. Mutations lock the company and relevant membership/agent/task rows to serialize completion, archive and suspension races. This favors correctness over maximum parallel write throughput within one company.

## Read/write contract

`GET /api/quick-tasks` requires `tenantId`. Optional filters are `tab=all|mine|created|archived`, `status=all|open|done`, literal title/description `search` up to100 characters, `overdue=true|false`, `limit`1–100 (default50) and an opaque cursor. Non-admins may use only Mine. Stable descending task pagination uses `(created_at,id)` and binds the cursor to tenant, actor, current linked agent, filters and timezone. Counts are exact across tab/search/overdue before the selected status and are not derived from a capped directory or current page.

The initial assignable roster is capped at100 with explicit `assignableAgentsHasMore` and `assignableAgentsCursor` for continuing after that initial page. Owner/admin-only `GET /api/quick-tasks/assignees` supports `tenantId`, literal name `search`, `limit`1–100 (default100), and a tenant/actor/search-bound opaque name/id cursor. The picker preserves selected/editing assignees across searches. Absence from the current picker page does not establish that an existing assignee is inactive; save/publish rechecks every submitted assignment under locks.

`GET /api/quick-tasks/:taskId?tenantId=...` returns permitted detail. `POST /api/quick-tasks` accepts `{tenantId,operationId,change}`. Creation takes `action:create`, `mode`, `publication`, `title`, `description`, `agentIds`, `startDate`, `dueDate`. Edit takes `action:edit`, `taskId`, `revision` and those detail fields except mode/publication. Publish/complete/reopen/archive/restore take only action, taskId and revision. A successful response contains `{saved:{operationId,action,tasks:[{id,revision}]}}`; callers must load a fresh snapshot after acknowledgement.

All reads and writes use the signed session and current database authorization; there is no privileged application key. Tables expose SELECT only through RLS, writes go through the authorized RPC, receipts are private, tenant-bound foreign keys prevent cross-company assignments. APIs use private/no-store responses and distinguish denied/malformed/conflicting/failed reads from empty success. Unsupported browser timezones are rejected before returning data.

## Local acceptance and remaining release checks

- `node --test tests/config/quick-tasks.test.mjs`: schema/filter/cursor, exact-count validation, bounded assignee RPC, acknowledgement binding, failure and timezone cases.
- `node scripts/test-quick-tasks-database.mjs`: disposable unpublished network-isolated PostgreSQL17; applies all immutable baselines plus this additive migration, verifies RLS/grants/tenant denial, lifecycle, atomic separate creation, current-authorization-before-replay, exact counts above1,000,105-user roster paging with duplicate names, company-calendar DST/skipped dates and completion/suspension races. The runner cleans up only its own unique container.
- Repository lint/config checks and TypeScript check are required before integration. Root owns combined Next build and real Auth/browser fixture checks.

Before release, verify desktop flows under real signed owner/admin/manager/employee sessions: draft privacy, shared completion versus independent completion, create/edit/publish/reopen/archive/restore, search and roster paging, role/assignment revocation, unknown response recovery including same in-memory payload replay, failed recovery reads retaining locks, and departure/return without persisting task field values. Verify no-store production headers. Root owns additive migration application and hosted release; final verified execution is recorded below.

## Full-parity backlog

Keep the full workforce roadmap. Remaining Quick Tasks work includes feature-specific granular admin scopes and user creation settings; recurring/scheduled publication; timed deadlines; labels and label filters; subtasks/checklists; attachments, rich descriptions and comments; notifications/reminders; duplication/templates; bulk actions; wider date filters and exports; audit UI; task permission settings; and separately reviewed deletion/retention policy. Mobile work is deferred under the current desktop priority. No fake GPS, payroll, approvals, notifications, paid upgrades or placeholder success behavior is introduced.

Final integration: check/build,56 configuration/query tests,82 isolated SQL/race assertions and six fresh real GoTrue/PostgREST/PostgreSQL/API/browser desktop cases passed. These verify draft privacy and roles/foreign tenants, owner lifecycle, shared versus independent completion, suspended/relinked assignment and revoked management receipts, exact counts above1,000 with microsecond keysets and concurrent arrivals, and one committed action/audit after a lost acknowledgement plus failed-read recovery and exact retry. Integrated detail/recovery screenshots were inspected. Independent final SQL/API/UI/page review found no blocker.

The reviewed SQL was applied once to verified CT Alt as `20261003222455_quick_tasks.sql` before releasing its consumer. Recorded SQL matches byte-for-byte; all20 preexisting public table counts and18 prior function definitions/owners/ACLs were retained. Three new public tables have RLS, authenticated SELECT-only grants and no anonymous or direct browser writes. Seven new functions have empty search paths and no anonymous execute; definer code stays private. The additional INFO notice for private quick_task_operations with RLS/no policies is intentional default-deny receipt storage, with browser table grants revoked. Existing advisory findings were retained. Existing applied baselines remain immutable. PR18 reviewed head23641bc303ea33fe7a205c5731e2888969cb84e8/tree5cca66da62586f7a65b3538415afcc2c446ce32f merged017c57b878c712ad444bdf353446b01dc920be74 after CI37158960575 passed. Matching Vercel production dpl_H4meT14svgMcZrpRtugKT5D1UnAe is READY with ct-alt.vercel.app alias; unsigned page307 and valid API401 verified. Real-account production authenticated acceptance remains unexercised.
