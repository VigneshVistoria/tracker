-- Multi-tenant conversion Phase B: auth becomes tenant-aware.
--
-- users.email was globally unique - two different tenants could never
-- have overlapping emails. Swaps that for a composite unique on
-- (tenantId, email), matching the application-layer change (JWT payload
-- now carries tenantId, login/register are scoped by it).
ALTER TABLE "users" DROP CONSTRAINT "UQ_97672ac88f789774dd47f7c8be3";
ALTER TABLE "users" ADD CONSTRAINT "UQ_users_tenant_email" UNIQUE ("tenantId", "email");
