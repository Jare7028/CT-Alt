# Tenant and Agents foundation review

Status: applied once to the independent CT Alt hosted project by the parent; recorded version `20261003143058`. Do not replay. This document describes the foundation migration; see `AGENTS_REVIEW.md` for the proposed record-management additions.

Migration: `migrations/20261003143058_workforce_foundation.sql`.

## Scope

Creates two empty tables, their indexes, read policies, a timezone validation trigger and one internal authorization helper. It imports no users or company data, alters no Auth configuration, and creates no invitation delivery or application provisioning endpoint. No existing table is dropped, replaced or backfilled. The transaction fails on conflicting objects instead of accepting an unknown schema.

`tenant_memberships` uses `(tenant_id, user_id)` as its primary key. One Auth identity can belong to several companies with different roles. Future agent and scheduling references must retain tenant IDs in their foreign keys.

## Grants and row access

- Both tables have RLS enabled.
- All table privileges are explicitly revoked from PUBLIC, anon and authenticated, including permissive project defaults.
- Authenticated receives SELECT only. There are no browser INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES or TRIGGER grants and no mutation policies.
- Active, confirmed, non-anonymous members can read their active companies.
- Employees can read only their own active membership. Owners, admins and managers can read memberships in their authorized company.
- Suspended companies and memberships remove access through stored database checks. User metadata and caller-supplied tenant/role labels do not authorize access.
- Service role receives explicit CRUD grants and bypasses RLS. It must remain server-only; future privileged API routes need their own authorization and audit coverage.

## Privileged helper review

`workforce_private.membership_role(uuid)` is SECURITY DEFINER solely to avoid recursive membership policies and read the identity eligibility fields. It lives in a non-exposed schema, uses an empty fixed `search_path`, fully qualifies every referenced object and derives identity only from `auth.uid()`. It returns only the current user's stored role for the requested company.

PUBLIC/anon execution is revoked. Authenticated may execute this internal lookup for policy evaluation. Keep `workforce_private` outside the project's exposed Data API schemas. No SECURITY DEFINER function is created in public. The timezone trigger is SECURITY INVOKER; its direct browser execution is revoked.

## Lifecycle and concurrency boundaries

- The composite primary key prevents duplicate memberships; competing inserts cannot create two memberships for the same person/company. The current suite tests duplicate rejection, not a concurrent provisioning API.
- Referential integrity rejects memberships for nonexistent users/companies. Explicit company or Auth-user deletion cascades to memberships. There is no browser deletion path.
- Suspensions are evaluated from stored membership/company state on subsequent database statements rather than JWT role metadata. Long-lived transactions retain PostgreSQL snapshot semantics; account-management transaction design is still pending.
- Membership role values are constrained. No platform/global-admin role exists.
- Active tenants require a recognized PostgreSQL timezone. Shift instants, overnight/DST behavior, scheduling conflicts and optimistic edit revisions belong to the scheduling migration and are not implemented or claimed here.
- Owner transfer, last-owner preservation, deactivation audit, membership invitations and atomic account provisioning remain required parts of Agents. Service-role callers could violate business-level lifecycle rules; membership/ownership management must wait for those operations to be implemented and tested. The proposed Agents RPC protects owners and provides atomic archive/restore handling.

## Recorded local verification

On 2026-10-03, `npm run test:db` passed **53 database assertions** against a fresh PostgreSQL 17 container using the pinned official image digest. The container had no network, exposed ports or persistent application volume, and was removed after the run.

Coverage includes explicit privilege denial, tenant isolation, per-company roles, employee directory visibility, metadata spoofing, anonymous/unconfirmed/non-member rejection, membership/company suspension, duplicate membership rejection, timezone and role validation, missing-company foreign keys and the privileged service-role boundary. The test bootstrap models only the minimal Supabase Auth schema and `auth.uid()` contract; it does not test real Supabase sessions, PostgREST, invitation emails or hosted defaults.

`npm run check`, `npm run build` and `git diff --check` also passed after these changes. The proposed CI step runs the isolated database suite without remote credentials; this branch's CI has not yet been run.

## Parent application gate (completed for foundation)

The parent verified the exact independent target and Free plan, applied the foundation once and checked grants/RLS/helper exposure. For subsequent migrations, verify target identity and current history before parent-controlled application. Never apply `tests/database/bootstrap.sql` remotely. Do not change another project's Auth or schema settings. After applying, verify table grants, policies, helper ownership/search_path, exposed schemas and database security advisors on the target. Preserve the migration's recorded version and do not replay it.
