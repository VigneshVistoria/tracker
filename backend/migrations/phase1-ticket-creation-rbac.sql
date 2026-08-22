-- ReleaseBot Phase 1: ticket-creation RBAC (Sections 1, 3, 34).
-- Adds Issue.source, used to tag tickets filed by an Executive or Program
-- Manager as a "Leadership Request" (auto-set alongside Priority = High -
-- see IssuesService.create()). No other schema change in this phase - the
-- role-based restriction itself is application-layer only.
--
-- Verified by generating this from TypeORM's own schema-diff tool against
-- the same local Postgres 16 instance used for Phase 0 (already at the
-- Phase 0 schema state), then re-running the diff tool afterward and
-- confirming zero remaining changes.

BEGIN;

ALTER TABLE "issues" ADD "source" character varying;

COMMIT;
