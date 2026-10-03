# Time Off desktop UI review

This is the calendar-day request and review baseline for CT Alt. It is original code informed by public Connecteam guidance, not a claim of full feature or visual parity. All local review data and captures are synthetic.

## Public reference evidence

Read on 3 October 2026:

- [Starting Guide to Time Off](https://help.connecteam.com/en/articles/6713889-starting-guide-to-time-off): desktop dashboard request review, paid/unpaid policy categories and policy setup.
- [Time Off for Users](https://help.connecteam.com/en/articles/6758841-time-off-for-users): desktop Time Off navigation, request type and dates, all-day requests with notes, pending cancellation and administrator handling of approved requests.
- [Time Off: Admins Permissions](https://help.connecteam.com/en/articles/6741264-time-off-admins-permissions): separate viewing, approval and policy permissions and scoped administrative access.
- [Creating Time Off Policies](https://help.connecteam.com/en/articles/6743822-creating-time-off-policies): policy duration, accrual, limits, assignments and working-day settings.

The public pages were fetched without private account access. Review caches were kept outside Git under `/tmp/ct-alt-<article-id>-<title>.html` and `.txt`.

## Implemented behavior

Active linked users request an active leave type for inclusive full calendar dates, with an optional note, and withdraw their pending requests. Date labels are calendar dates, not timezone-converted instants. The form explicitly counts every calendar day, including weekends; 24–26 October 2026 remains three days across the Europe/London clock change. It does not present entitlement, accrual, working-day or payroll balances.

Owner/admin capabilities expose team review and leave-type creation/archive. Per-record server capabilities control approve, reject, withdraw and approved cancellation. Reject and cancellation require a reason; approval allows a blank reason. Archived type snapshots and retained historical user names remain visible in existing requests and history. An inactive requester's pending record can retain rejection access while approval is disabled.

My requests is the initial view. Team search, status, leave type, overlapping inclusive date range and exact user filters use the server query contract. Filter this user captures the immutable historical agent ID instead of relying on a capped active directory. Exact status counts are independent of the displayed page and apply before status filtering. Load older requests sends the opaque cursor and current query; a fresh query clears old rows before loading. The desktop table scrolls within a bounded panel with sticky headers.

GET consumes the actual raw `TimeOffData` contract. POST acknowledgements must match UUID, action, target IDs and expected revision before a fresh read can unlock the UI. Request creation captures the current linked agent ID in its payload, so retry never silently substitutes a new assignment. Every retry reuses the exact in-memory payload and UUID. SQL/API remain authoritative for current membership, assignment, permissions, overlap and revision conflicts.

A pending POST synchronously blocks manual refresh and other writes. The recovery marker contains only operation UUID and action under the actor/company key; it contains no dates, fields or notes. Lost responses, malformed acknowledgements, conflicts and failed refreshes clear visible private data and keep new writes locked. In-place retry is available only while the exact payload remains in memory. Departure and return permit a fresh-read recovery, without reconstructing fields from storage. Successful recovery clears the marker. Role, company, actor and linked-agent changes reset drafts and details; aborted or stale reads cannot restore old private rows after access denial.

The shared production page/navigation wrapper is integrated by the release owner. The synthetic fixture renders that actual DashboardShell and inner Time Off component. The fixture route is generated only for the isolated runner and removed on cleanup; no fixture page is committed under `app/`.

## Local acceptance evidence

`node scripts/test-time-off-browser.mjs` runs 17 Chromium desktop cases at 1440 × 1050, on isolated port 5194 with an invalid Supabase configuration and mocked API replies. Coverage includes type setup/archive, approval/rejection/cancellation history, inclusive-day request/withdrawal, exact counts of 123 requests and 50-row paging, retained-user filters, committed/lost acknowledgement and exact replay, failed recovery, held POST/manual-refresh/departure locks, departure during successful acknowledgement body decoding, stale GET followed by denial, four identity-context replacements, captured-agent replay denial, revision/overlap conflicts, malformed acknowledgement and disabled inactive-user approval.

All 17 cases passed after the final desktop layout refinements and departure guard. The optional agent-browser verification also passed: hydrated nonempty content, accessible controls, no Next error overlay, root smoke navigation and screenshot. `npm run check` passed on the integrated UI candidate. The release owner runs the final combined check/build and fresh real Auth/API/browser acceptance after merging current main. Synthetic checks do not replace real server authorization evidence.

Rendered captures inspected locally: `test-results/time-off-team-desktop.png`, `time-off-employee-desktop.png`, `time-off-detail-desktop.png`, and `/tmp/ct-alt-time-off-gut-check.png`. Copies of the three desktop captures are preserved under `/tmp/ct-alt-time-off-*-desktop.png` before later acceptance runs replace test-results. These generated artifacts are outside Git or ignored and contain only synthetic names. No hosted migration, production fixture, paid resource or release was performed by this UI worker.

## Remaining reference gaps

Partial/hourly leave, working-day and holiday calendars, policy assignments, granular delegated permissions, entitlement/accrual/carryover, attachments, notifications, exports, administrative requests on behalf of users, approval chains and calendar/scheduler/payroll integration remain future slices. Mobile polish remains deferred under the desktop-first instruction. Retain the full workforce roadmap rather than treating this baseline as completed Connecteam parity.
