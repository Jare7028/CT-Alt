# Displayed draft publication acceptance

Local integration is accepted against released Templates main `fa40c91`. Hosted publication schema was applied once as `20261004163547_rota_visible_publication.sql`; consumer release remains pending. All22 earlier migration identities/bytes and99 existing table contents remain exact, with all prior function/relation/policy/trigger metadata retained. Only two authenticated functions were added; no operational rows changed. All23 migration files are immutable.

Owned verification files are `scripts/test-rota-publication-database.mjs`, `scripts/test-rota-publication-integration.mjs` and `tests/browser/rota-publication.spec.ts`. The integration runner starts a fresh labelled loopback fixture for each of `publication`, `retained-rotas` and `retained-templates`, reserves its ports/lock, restores the checkout's prior environment file and removes only owned resources. The retained Rotas fixture adds the canonical synthetic unsupported-timezone schedule solely inside its disposable database.

Frozen candidate `20261004163547_rota_visible_publication.sql`, SHA256 `63fcbfa5740417b2b2b3c4d168066d80275e42978ded2f38ceb318902646629a`, passed 41 actual SQL assertions, exact populated upgrade preservation and nine genuine concurrent-transaction races. Preservation includes Auth/Storage and prior application row contents, table identities/columns/owners/ACL/RLS/policies, and function identities/definitions/owners/ACL/config/security metadata. The 5,000-target test publishes the complete set atomically with one audit entry; queued legacy edits/publication, template application and current Auth/delegation/worker/archive changes fence stale or denied subsets.

All 11 genuine signed Publication cases passed on the frozen built app in 1.2 minutes. They verify exact current owner/admin/delegated-manager subsets; field-free employee/foreign/revoked-manager denial; stale, duplicate, empty and foreign-schedule atomic rejection; the real submitted filtered/overnight set and byte-identical hidden drafts; employee visibility; membership/archived-worker fences and immutable roster foreign-key protection; retained explicit legacy whole-schedule publication; held/lost actual committed acknowledgements; a prior real successful read released after current denied publication; and confirmation-revision conflict. Application function definitions and unrelated rows, plus all application/Auth/Storage table permission metadata, remain exact across the signed suite.

Separate fresh retained suites passed: Rotas 7 cases (34.2 seconds), Templates 11 cases (1.2 minutes), and Requests 8 cases (2.6 minutes). Retained Rotas changes only the publication period, confirmation action label and exact counted success notice to match the new displayed-subset UI; all legacy API authorization, own/coworker visibility and subsequent workflow checks remain. The new genuine suite also directly verifies the unchanged legacy whole-schedule publication action.

A separate bounded `capture-confirmation` diagnostic reran the existing filtered/overnight case on another fresh genuine fixture: one case passed in 9.5 seconds, with a 1,444-pixel original synthetic confirmation image reviewed outside Git. The count of two, frozen week/UTC/worker/job/status caption and complete dialog controls were readable; the overnight cells represent one submitted draft. This capture adds only conditional instrumentation and does not replace or narrow the earlier full 11-case result.

Whole lint/typecheck, all 220 configuration cases and production build passed. The runners restored the prior environment file and removed their owned processes, labelled containers, temporary configuration and lock. All six assigned ports were independently checked free after cleanup. No hosted Auth, SQL, messages, deployment or other project resources were touched by these local checks. Hosted application and exact existing data/security preservation are verified. Exact-head CI, consumer merge and matching production verification remain release gates.

Frozen SHA256 identities:

| File | SHA256 |
| --- | --- |
| Candidate SQL | `63fcbfa5740417b2b2b3c4d168066d80275e42978ded2f38ceb318902646629a` |
| SQL runner | `372f62dea71d3a102490479a1043a27e4f02959239da95b74fd982f5da34958f` |
| Integration runner, including bounded capture mode | `44e44038c1e64d9e937dd71a0cc21fe3e102ccaeaa9c2b30860af5f0053352fb` |
| Signed spec, including conditional capture | `0e1214d3b31e06f533e4692ba23fec6bb2d35f90d425c6451fe7d2dd46687417` |
| Scheduler UI | `7c282da5018f47cb5491409acd46564dd285c4171db7650668209b61aa7234b6` |
