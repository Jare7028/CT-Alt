# Client rotas: first functional slice

Base: main at `2f1394fc4511a66b711c364aa2407ef52c9f5651`. Independent checkout: `/workspace/ct-alt-rotas`. Route: `/rotas?company=<tenant-id>`.

## Verified source and scope

The [official starting guide](https://help.connecteam.com/en/articles/4100339-starting-guide-to-the-job-scheduler) describes a schedule board with user rows, day columns, Day/Week/Month views, coloured jobs, single shifts saved as drafts or published, and schedule administrators. The [official creating-shifts guide](https://help.connecteam.com/en/articles/8986051-creating-shifts) describes Add → Add single shift and the core shift fields. Its public animation was inspected for visual grounding; it was not copied into this repository. This implementation uses original CT Alt code and assets. Functional coverage below is limited to this slice; pixel parity is not claimed.

## Implemented

- Active/archive schedule lobby, name search, assigned-user counts, separate named manager administrators, and schedule timezone.
- Company owner/admin creates a named schedule, selects existing active Agents, and grants selected managers schedule access. Owner/admin company access remains available.
- An authorized schedule manager adds named, coloured jobs; Add → Add single shift saves an assigned draft. Drafts can be edited.
- Publish confirms all schedule drafts, including dates outside the displayed period. Publication is atomic and employee visibility follows database policy.
- Employees see only their own published shifts; neither coworker shifts nor drafts are exposed through the API.
- Day/Week/Month board, date navigation, user search, user sort by name/hours, job/status filters, daily totals and visible-period hours/shifts/users summary.
- Owner/admin can archive and restore schedules. Archive retains drafts and published records, keeps both in overlap warnings, and blocks editing/publishing until restoration. Archiving is not shift cancellation.

## Permission and concurrency boundary

`docs/proposals/client-rotas.sql` is proposed SQL, deliberately outside migration history. Parent must review and assign a migration version. No hosted migration was applied.

Every child foreign key contains its tenant and relevant schedule. Exposed tables have RLS and explicit read grants; direct browser writes and anonymous access are revoked. The public RPC is an invoker wrapper over a fixed-search-path private definer, matching the existing Agents mutation boundary. Actor identity comes from `auth.uid()`; roles come from active, confirmed tenant membership.

Owner/admin has company-wide scheduling access. A manager needs an explicit schedule grant; an employee only reads own published assignments. Smart-group segmentation does not exist in the current schema and is deferred: a granted manager manages the selected schedule's entire assigned roster.

A stable invoker read RPC returns the entire bounded rota payload from one SQL statement snapshot, with table RLS enforced. Shift data and schedule revisions therefore describe the same database state. Each change requires the schedule revision from that snapshot. A company lock serializes scheduler writes across schedules, allowing cross-schedule overlap checks to reject concurrent collisions. Overlap requires explicit acknowledgement after a warning. Agent and membership locks protect active-access checks at save/publish. Events record actor/action/revision, without duplicating employee contact details.

New schedules accept UTC or geographical IANA zone names validated by PostgreSQL and the server Intl implementation. Unsupported special names are rejected. A legacy zone unsupported by the browser renders a visible UTC fallback and blocks editing; no unsupported zone can crash the formatter. Times are stored as finite timestamp instants with explicit offsets and a maximum duration of 24 elapsed hours. Calendar input uses the schedule IANA zone, independently of the browser zone. Missing DST times are rejected; repeated times require earlier/later selection. Overnight hours split at local midnight; clock changes count elapsed time. Calendar boundaries cover midnight transitions and skipped dates.

The read RPC aggregates bounded arrays inside SQL so PostgREST row limits cannot silently truncate nested collections. The initial API fails closed if the returned arrays exceed configured capacity. Pagination is deferred. Company serialization favours correctness over throughput.

## Acceptance coverage

| Layer                          | Coverage                                                                                                                                                                                                                                                             |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 17                  | Tenant isolation, composite FK protection, table grants/RLS, employee draft privacy, published self-only reads, delegated permissions, suspended access, input checks, adjacency/overlap, published-edit guard, archive/restore, publish rollback for inactive users |
| Concurrent PostgreSQL sessions | Stale writer, cross-schedule overlapping writers, actor suspension                                                                                                                                                                                                   |
| Node config/timezone tests     | Spring gaps, repeated fall times, fractional-offset zones, half-hour DST, 23/25-hour days, overnight splitting, midnight transitions, skipped calendar dates, Monday weeks, leap months                                                                              |
| Browser and API                | Synthetic owner creates schedule/job/draft and edits; manager publishes; employee has no draft visibility before publish and own published shifts afterward; Day/Week/Month totals, search, responsive board, API auth/origin validation                             |
| Build                          | `npm run check`, `npm run build`                                                                                                                                                                                                                                     |

Run `node scripts/test-rotas-database.mjs` for a fresh network-disabled temporary database. It applies only existing foundation/Agents migrations and this proposal, uses synthetic fixtures, and removes its own container. Run `npm run test:config` for timezone and existing boundary tests. Browser tests use only the explicitly checked loopback fixture at `http://127.0.0.1:54821`; never point them at hosted resources.

## Integration and remaining work

Parent owns migration numbering, independent reviews and deployment. Proposed shared navigation addition: “Client rotas” → `/rotas`. The sole approved shared change is an additive `/rotas/:path*` proxy matcher entry so refreshed Auth cookies persist on direct navigation. Existing matcher entries are preserved. Shared navigation, Auth implementation, agent types and existing migrations are otherwise unchanged.

Remaining: roster/admin editing after creation; agent-group qualification/permissions; unassigned shifts and capacity; open-shift claim/unclaim; swaps; templates; requests; notifications; confirmation/completion; repeating/all-day/group shifts; location/notes/tasks; job editing; draft deletion; safe published-edit/re-publish lifecycle; calendar virtualization/pagination; richer view options and job/layer views. No inactive controls imply these features exist.

## Repeatable browser fixture and results

On a machine with Docker and repository dependencies installed:

1. Run `env -i PATH="$PATH" node scripts/rotas-browser-fixture.mjs`. This creates a separately labelled, disposable local PostgreSQL/Auth/PostgREST stack. Test-only keys and synthetic account credentials are generated in memory and written only to ignored/private fixture files. No hosted credentials, real workforce data or email server are used.
2. Use a fresh disposable fixture for each full browser suite run. Once ready, start `env -i PATH="$PATH" NEXT_TELEMETRY_DISABLED=1 npm run dev` in another terminal. Restart the dev server after recreating the fixture so it loads the new loopback public key.
3. Run `env -i PATH="$PATH" npm exec -- playwright test tests/browser/rotas.spec.ts`.
4. Stop the dev server and fixture. The fixture removes only containers bearing its random run label and its own network.

Validation: 112 isolated PostgreSQL assertions, 19 config/timezone tests and 4 browser/API acceptance tests passed, together with lint/typecheck and production build. Browser acceptance includes a correctly signed, expired local access token with a valid refresh token: direct `/rotas` navigation refreshes it, persists replacement cookies and retains API access. The full Supabase CLI image initially exceeded Docker disk capacity; the smaller fixture completed the real Auth → API → database workflow.

Synthetic screenshots: [schedule lobby](screenshots/rotas-lobby.png), [draft shift form](screenshots/rotas-shift-dialog.png), [manager board](screenshots/rotas-manager-desktop.png), [employee board](screenshots/rotas-employee-desktop.png), [mobile board](screenshots/rotas-mobile.png).

## Corrective review evidence

- The additive CI script/step was verified at commit `0baeea9212a2c1362145a2a5efb06329ee7d461c`: [run 37142546558](https://github.com/Jare7028/CT-Alt/actions/runs/37142546558) executed and logged all original 95 rota assertions without replacing foundation/Agents checks.
- Archive semantics follow retention and restoration in the [official archive guide](https://help.connecteam.com/en/articles/10026303-how-to-archive-duplicate-and-delete-a-job-schedule). This slice retains archived assignments in conflict checks; it does not imply Connecteam's undocumented conflict algorithm. Tests cover archived published and draft collisions and an actual restoration/save race.
- The old HTTP route's potential mixed read was identified from its separate network queries. The corresponding old-shift/new-revision interleaving was reproduced using independent PostgreSQL reads; the old HTTP request itself was not driven under a controlled race. The replacement read RPC was exercised in real concurrent PostgreSQL sessions with a writer committing during the reader's statement. It returned a consistently old snapshot, and the next read returned both new shift data and its new schedule revision.
- Real concurrent sessions cover target-agent archive while publication waits, preservation of the rejected draft, and delegated manager-grant revocation while a mutation waits. These are reproduced tests, not only code-derived interleavings.
- Disposable PostgreSQL 17 lists Factory and posixrules but not localtime. All three are rejected by schedule mutation tests. Node tests guard special/unsupported names, and a real browser/database fixture with a legacy Factory record renders safely and blocks editing.
- The real Auth browser workflow includes a coworker's draft and published shift alongside the employee's own shift, proving employee API and browser privacy with competing data present.

[Unsupported-zone browser evidence](screenshots/rotas-unsupported-zone.png). No hosted SQL was applied and no existing migration was changed. Common shell/layout/global CSS/navigation integration remains parent-owned.
