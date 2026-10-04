# Smart Groups desktop UI review

This is an original CT Alt desktop implementation of the bounded [delivery contract](SMART_GROUPS_CONTRACT.md). It manages organizational workforce records; communication eligibility is displayed separately and never grants account access or assigns content.

Public reference evidence was read from the official [Smart Groups and Segments guide](https://help.connecteam.com/en/articles/6114686-smart-groups-and-segments), [Users Save as Group guide](https://help.connecteam.com/en/articles/6847572-how-to-create-a-smart-group-from-the-user-s-tab) and [profile-field troubleshooting guide](https://help.connecteam.com/en/articles/8061578-troubleshooting-smart-groups-i-m-having-difficulty-adding-a-user-to-a-smart-group). Cached prose and selected public illustrations under `/tmp/ct-alt-smart-groups-research` informed the desktop hierarchy, segment organization, rule editing, preview and group search. No competitor assets are committed. Public reference images span multiple historical versions; this slice makes no pixel-perfect or complete feature-parity claim.

## Delivered interactions

Groups and Segments views have explicit search, status filters, exact totals and bounded opaque cursor paging. Segment cards show their current active child counts. A nonempty segment cannot be archived; archive and restore are explicit CT Alt retention extensions. Creating, editing and moving a group requires an active segment. The searched, paged picker retains the selected segment's ID and name when another search/page excludes it. Editing first reads the complete current group and its parent via the scoped members endpoint, including an off-page parent.

The rule editor supports 1–10 required AND clauses, each with 1–25 distinct literal alternatives. Title, Team and current registered custom text fields are selectable. Values remain case-sensitive, and meaningful leading/trailing spaces are preserved. Blank/duplicate values and unavailable fields block preview/save. Both preview and save enforce the combined 40 KiB UTF-8 envelope guard, alongside individual field bounds.

Changing a rule immediately cancels its previous preview. A preview verifies the exact echoed rules, current fields and scope before showing counts and paged members. Zero matches are valid. Saved group membership and previews show matching active records, communication-eligible accounts, unlinked records and unavailable linked accounts separately. Name searches affect the exact searched row count while retaining whole-population totals. Opaque dataset/field versions remain strings and prevent mixing pages from different evaluated populations.

Retained groups with unavailable fields show Needs review and null counts. The editor retains the unavailable clause, requires an explicit repair, and does not replace it with a broader rule. Catalog/member/preview responses with incompatible rules, fields or population counts fail closed.

## Recovery and privacy

Every leaf request has an abort controller and a mounted/current generation check after decoded data. Manual refresh, scope replacement, editor close, member close, rule changes and new queries cancel relevant old reads. Current failed, malformed or denied reads clear all catalog, segment, member, picker, preview and draft data; controls resume only after a successful current owner/admin recovery read.

A POST holds a synchronous write guard through decoded acknowledgement and its review read. Refresh, other leaf reads and additional writes cannot race it. The acknowledgement binds operation UUID, action, target IDs and expected revision. On an uncertain response the exact payload may be retried only while still held in memory. Session storage contains only the actor/company-scoped operation UUID and action marker; no names, rules or profile values. Departure loses the in-memory payload, keeps the field-free marker, and requires fresh all-status group and segment reads rather than replaying fields. Different field/population versions across those recovery reads remain locked. A decoded acknowledgement arriving after departure cannot start a follow-up GET or clear the marker.

Stable accessible controls include Add segment / Save segment, Add group / Save group, Rule N field and value M, Select segment {name}, Preview matches, Matching preview, View members {name}, Group members, Refresh to recover and Retry last action. Native labelled dialogs support keyboard cancellation and return focus. Member and group tables use semantic headers and captions.

## Verification

The isolated synthetic runner generates and removes its temporary route, uses disabled Supabase configuration and port 5195, and never creates hosted/Auth fixtures. Run `node scripts/test-smart-groups-browser.mjs`; set `CT_ALT_AGENT_BROWSER` to the installed CLI path to include the required desktop gut-check and home navigation smoke.

The final focused suite passed all 47 meaningful component cases in 1.1 minutes: exact literal alternatives and AND/case behavior; zero previews; >1000 counts with 50-row pages and name search; CRUD/move/archive/restore; searched off-page segment selection; missing-field repair; rule/value/envelope bounds; all current read denials and failed recovery; malformed DTO/ack scope/count/field/target/revision checks; population-version page conflicts; actor/company/role/departure fences; synchronous held POST guards; acknowledged-then-lost acknowledgement recovery and exact retry; field-free departure recovery; decoded acknowledgement/preview body departure; cancelled member paging; and later catalog search winning a delayed query. These fixtures prove UI behavior, not database or hosted permission enforcement. The integrator separately runs the signed Auth/browser and database acceptance suites.

Owned TSX, fixture, test and runner ESLint checks and `tsc --noEmit` passed. Agent-browser verified meaningful content, no framework overlay, interactive controls and navigation to the root route. Desktop captures were visually inspected at `/tmp/ct-alt-smart-groups-desktop.png`, `/tmp/ct-alt-smart-groups-preview.png` and `/tmp/ct-alt-smart-groups-gut-check.png`; shared landing-page CSS was explicitly overridden within this module to keep controls compact and its catalog full width. Captures use synthetic CT Alt records and include test-only context controls. The real signed acceptance capture is owned by the integrator.

Full combined `check`/build, signed Auth acceptance, independent immutable review, hosted migration and release remain integrator-owned. No shared navigation, page, SQL, API, credentials, production service or deployment was modified by this UI slice.

## Remaining roadmap

Granular group administrators/feature permissions, protected account-based All Users/All Admins, content assignments, Users Save as Group, profile membership display, typed dropdown/date/number operators and time-based recalculation remain later increments. This slice does not substitute cosmetic wizard steps or login ratios for those features. Mobile polish is deferred.
