# Requests acceptance

## Current verified release

PR32 is released: main `de023f0edb6db888062661c59bdbcd5e4c83dec8`, passing CI `37200205189`, READY production `dpl_CrievaTxw817FiZHhz25Pe9LHJgt` at ct-alt.vercel.app. All 48 fictional cards are live: 24 New, 12 In progress, 12 Done. The owner subsequently requested natural wording, superseding visible Demo labels. Each card now has a unique site-specific title and useful description; dates, priorities, stages and eligible linked assignments are retained. Read [current content evidence](LIVE_DEMO_DATA.md). The schema and original seed must not be replayed. Pending-release statements below are historical snapshots.

The owner requested a general work-request kanban and live fictional demo data on 4 October 2026. The implemented company-scoped workflow follows [Requests contract](REQUESTS_CONTRACT.md), with the existing standard desktop shell and original CT Alt assets.

## Verified application

UI checkpoint `0afaf3cd26e72f7b9f9b64e87defa873734fc489` and core checkpoint `6182a8120163afb13e621cbc2db4c3e4aa3700f4` were integrated with actual released main `8e29552f1a724a0f5c2668bc039389a3e5fec59a`. Subsequent Auth test fixes change no application/API/SQL code. New Requests SQL SHA256 is `eeb150cf9a54609d447d7c0b1b55ab2ea830cc24b8d6a9a520ff4b699b7320aa`; all19 previously applied migrations remain byte-identical.

- 186 configuration/query checks passed, including12 Requests cases.
- 75 genuine isolated Requests SQL assertions, four transaction races and populated prior-schema/data/function/owner/ACL/RLS/policy preservation passed.
- 30 synthetic desktop browser cases passed, including native drag, keyboard status controls, loaded/read-only/held-save focus, assignment identity, paging, stale responses, revision conflict, strict ACK, exact retry and field-free recovery.
- All eight genuine local Auth/API/browser cases have passing evidence across fresh fixtures. The first six passed in full fresh attempts; desktop create/edit/assignment/keyboard/drag/paging passed in a fresh setup subgroup, and the final held-response/departure/recovery/current-denial case passed in its own fresh fixture. This is not a claim of one uninterrupted eight-case run. Production builds passed, and old data/function assertions passed after the successful subgroup fixtures.

Initial desktop Auth attempts used an exact implicit-label selector that includes the prefilled textarea text. A bounded browser reproduction and the signed DOM both showed zero exact label matches and one exact accessible Description textbox. Changing only that test locator verified the existing editor and persisted edit. The held-save departure test subsequently used the genuine Next Users link's DOM click to force a same-document departure under the intentionally blocking modal, retaining all late-ACK/marker/recovery assertions. These test fixes did not weaken product guards or change application code.

The signed paging case fetched all1005 test requests in exact microsecond/UUID order and verified literal Unicode/symbol searches and changed query/actor/version rejection. This populated test is slower than the small demo board. Existing login and hosted data were never used as acceptance fixtures.

## Rendered desktop

[Signed desktop capture](screenshots/requests-auth-desktop.png) is original CT Alt at1444×960 using actual isolated Auth/PostgREST/Postgres and fictional data. It shows the persisted edited Done card after keyboard and native drag movement, a literal search, all three columns and current assignment. The shared56px topbar/196px sidebar,78px module heading, Noto Sans and no horizontal overflow were inspected. It is not an authenticated Connecteam capture or proof of exact current competitor pixel parity.

## Hosted release gate

The reviewed additive migration must be applied once through tracked history to CT Alt only, with all old application/Auth row digests, security metadata and Auth settings retained. A single new private RLS/no-policy INFO is intentional for the inaccessible receipt table; new warnings or other findings are rejected. Match the local proposal filename to the actual registered version without changing bytes, then verify exact-head CI and matching Vercel production before claiming the board live. Add the separately authorised48 labelled demo requests through the recorded signed-owner RPCs, with rollback-first and exact replay/no-duplicate verification.

The additive migration was applied once as `20261004114249_requests_board.sql`, with the same reviewed SHA256. All78 pre-existing application/Auth tables and their row digests,122 prior application functions and security metadata, old indexes/triggers and Auth settings were retained. History now has20 immutable migrations. No new security warnings were introduced; one new private receipt-table RLS/no-policy INFO is intentional default-deny. The application consumer and48 Requests demo cards remain pending the release checks above. Never replay the hosted apply helper.
