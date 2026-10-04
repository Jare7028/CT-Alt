# Updates desktop UI review

CT Alt implements an original desktop Updates baseline: fixed selected-user announcements, draft management, a current-recipient feed, configured engagement and separate administrator recipient statuses. This is not a full feature or visual parity claim. The public reference research, local fixtures and rendered captures contain no private account or workforce data.

## Public reference evidence

The research memo and original public article HTML/prose are cached outside Git in `/tmp/connecteam-updates-research/`. The UI worker read that memo and the following official guidance:

- [Starting Guide to Updates](https://help.connecteam.com/en/articles/6489615-starting-guide-to-updates-an-engagement-feature): desktop sidebar, Add New, composition, selected employees, publication, title search and archive/restore. Templates and rich attachments remain future work.
- [Updates for Users](https://help.connecteam.com/en/articles/9818916-updates-for-users): desktop feed and administrator-configured reactions/comments, visible to the announcement audience.
- [Assigning Updates](https://help.connecteam.com/en/articles/8876359-assigning-updates-to-employees-smart-groups-and-or-selected-users): selected users differ from fixed and dynamic Smart Groups. This slice explicitly names its fixed selected-user audience.
- [Tracking Engagement](https://help.connecteam.com/en/articles/6533885-how-to-track-engagement-on-updates): individual viewed/not-viewed statuses, administrator engagement statistics and recipient filtering.
- [Pop-Up Updates](https://help.connecteam.com/en/articles/6510543-pop-up-updates): explicit confirmation differs from viewing; confirmation can occur in the feed. CT Alt implements that explicit in-update action, without a global pop-up, reminder or notification claim.

The wider research memo also records scheduled removal/publication, user-post permissions, notifications and paid-plan caveats. No private Connecteam session, paid feature or reference application access was used.

## Implemented behavior and boundaries

My feed opens first and shows only the signed user's currently authorized published updates. Owner/admin capability exposes a separate Manage updates view, title/body drafts, engagement settings and publish/archive/restore actions. Published text, settings and fixed recipients are immutable. Archive removes the post from recipient feeds and stops engagement; restore uses the same published content and audience.

The draft picker searches and pages current Auth users, 100 at a time. Explicit selections and retained names survive search changes and off-page results. The visible and enforced audience limit is 500. Existing selected recipients remain visible when editing a draft, even if absent from the current picker page. The API/database still validate current eligibility when saving or publishing. The picker is not a dynamic group or an implicit all-user audience.

Literal title search, exact scoped status totals and opaque keyset paging use the raw typed API contract. Feed and management pages request 50 posts. Count totals are independent of the loaded page. The separate owner/admin recipient-status panel requests 50 rows and exposes exact recipients/viewed/confirmed/likes/comments totals plus status filtering. Its GET does not trigger engagement. The synthetic analytics case uses the real maximum audience of 500, while the synthetic searchable roster contains 1,005 users; it does not claim a published audience above the server limit.

Opening authorized update details renders a visible panel before issuing the explicit UUID `view` command. Listings, title searches, recipient statuses and ordinary GETs never mark a view. Confirmation remains a separate recipient button and reflects the returned confirmed timestamp. Owner/admin management access does not grant recipient engagement. Like/unlike, comments, own comment editing/removal and supported moderation use per-record capabilities and configured settings. Removed comments display a removal placeholder without the old body. There is no optimistic success or client-supplied viewed timestamp.

All detail, roster and recipient-status responses must match current tenant, Auth actor and role before application. The component key changes with company/actor/role. Every asynchronous read has an abort controller, request identity and global generation fence; denial or context replacement clears private details, analytics, recipient selections, editor values and controls. A current failed read produces recovery, rather than an apparent empty result. Auth-user communication identity is independent of linked workforce-agent identity.

Writes synchronously block manual refresh and competing actions, including forced clicks on disabled controls. Acknowledgements bind UUID/action/post ID/content revision, lifecycle revisions and comment IDs/revisions as applicable. Recipient engagement accepts a safe positive acknowledged post revision because an authorized retry may return an earlier receipt after archive/restore; its content revision and target must still match. Fresh reads remain authoritative. Departure during acknowledgement JSON decoding cannot start an old-component GET.

The actor/company recovery marker contains only operation UUID and action. It contains no title, body, comment, recipients or field values. Unknown management actions recover through the current authorized Manage/all read, including after departure/return, rather than treating an empty personal feed as review of a draft. Lost admin authority keeps that management recovery locked. Personal unknown actions recover through the recipient feed. In-place retry reuses the exact in-memory UUID and payload; a remount does not reconstruct private fields for replay. Failed recovery and denied access retain the marker and lock until a successful relevant fresh read.

## Local acceptance evidence

The isolated `scripts/test-updates-browser.mjs` generates a temporary fixture route, renders the actual shared DashboardShell, runs Chromium at 1440 × 1050 on port 5195 with invalid Supabase configuration and mocked raw DTOs, then stops only its server and removes its route. No fixture route is committed under `app/`.

The final focused suite covers draft setup/edit/publish and fixed audiences, searched/off-page picker selection, the 500-selection cap, employee-only engagement, explicit visible views versus confirmation, likes/comments/edit/soft-removal, disabled engagement, nonrecipient management, archive/restore, exact 123-post counts and 50-row paging, exact 500-recipient analytics, lost acknowledgements and exact replay, management recovery after return/downgrade, held-POST refresh/departure, decoded-body departure, role/company/actor replacement, delayed authorized detail followed by denial, identity mismatches on all scoped readers, malformed acknowledgements, revision conflicts and earlier-revision engagement replay. These are synthetic component tests; the release owner's fresh real Auth/API/browser runner supplies server authorization evidence.

All 23 final synthetic cases passed in 37.7 seconds. Targeted ESLint and `tsc --noEmit` passed. The optional agent-browser gut-check passed hydrated meaningful content, accessible controls, no Next error overlay, root smoke navigation and a screenshot. Inspected synthetic captures are preserved outside Git under `/tmp/ct-alt-updates-*-desktop.png`, with detail and gut-check captures alongside them. The release owner runs the final combined check/build, real Auth acceptance, independent review and release. This UI worker performs no hosted migration, production fixture, push or release.

## Remaining reference gaps

Rich design/backgrounds/templates, attachments/media/polls, topics, fixed/dynamic Smart Groups and combined audiences, configurable user posting, published editing with renewed confirmation revisions, scheduled/recurring publish/removal, global pop-up/remind-later/expiry/custom confirmation text, mobile pins, notifications/reminders/SMS, exports/group-by/custom fields, AI/translation/shortcuts and granular admin permissions remain future slices. Mobile polish is deferred under the desktop-first instruction. Preserve the complete workforce roadmap; do not present this baseline as complete Connecteam parity.
