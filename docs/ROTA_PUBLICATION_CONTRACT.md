# Displayed draft publication

This increment makes the scheduler's Publish action publish the exact draft subset displayed when its confirmation opens. A company owner/admin or a manager currently delegated to the schedule can confirm publication. The subset follows the displayed Day/Week/Month period, positive period overlap, job/status filters and worker-name search. An overnight shift appearing in multiple calendar cells is included once. The confirmation freezes IDs and revisions; hidden and out-of-period drafts remain private.

## API and atomic behavior

POST `/api/rota-publication` accepts only `{tenantId,scheduleId,scheduleRevision,shifts:[{id,revision}]}`. It requires 1–5,000 distinct draft IDs belonging to the same company and schedule, with a 512 KiB request limit. The server bounds and validates the body, verifies signed identity, validates the exact resulting set and checks current schedule access before returning `{saved}` with `schemaVersion`, `tenantId`, `actorId`, `schedule_id`, `schedule_revision`, `published_count` and `shifts`.

The additive `public.publish_rota_shifts` invoker RPC delegates to an empty-search-path private writer. It serializes with the existing scheduler's tenant mutex, locks current identity/membership, the schedule and delegated grant, and validates the complete submitted draft set and revisions before writing. Every selected draft gains published status, publication time and one revision; the schedule gains one revision and a publication audit entry. Directory-only workers remain supported. Assigned workers must currently be active and linked workers must retain active company access. Any invalid member rejects the whole subset. Unselected shifts, assignments, jobs, templates, Auth and other module data remain unchanged.

The existing `save_rota` publication action and `/api/rotas` contract continue to publish all schedule drafts when explicitly invoked. No applied migration or legacy function body changes. This endpoint does not send notifications, create accounts, apply templates or change shift times.

## Lost confirmation

Publication has no automatic retry or durable operation receipt. A held request locks the confirmation and other scheduling writes. A lost or unverifiable acknowledgement keeps the scheduler uncertain. The user must reload schedules and review the actual published result before another action. Reload does not resend publication. Current denial clears protected state and invalidates delayed responses; an old read or acknowledgement cannot restore it.

## Verification and limits

The isolated database runner loads all 22 retained baselines with genuine pinned Storage 1.77.5/native73, populates prior scheduling/template history, compares exact old rows and function/table permission metadata across the additive migration, then runs publication assertions and genuine races. Signed built-app cases exercise current roles and tenant boundaries, atomic invalid subsets, filtered/overnight publication, employee visibility, stale and revoked workers, held/lost acknowledgement behavior and delayed-response denial. Fresh retained Rotas and Shift Templates suites check existing workflows after integration.

The public Connecteam guide supports publication by displayed period and filters. CT Alt's positive-overlap rule, overnight deduplication and worker-search inclusion are explicit local behavior; the guide does not establish those exact boundaries or DST/search interactions. These local checks are separate from hosted application, exact-head CI, merge and matching production verification. The scheduler retains its existing 5,000-shift whole-read ceiling. Notification delivery, scheduled publication, per-worker acknowledgements and broader scheduling parity remain outside this increment.
