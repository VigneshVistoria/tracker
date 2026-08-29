-- Multi-tenant conversion Phase E: tenant provisioning.
--
-- isPlatformSuperadmin is orthogonal to the existing per-tenant `role`
-- column - it's platform-wide staff power (can create new tenants),
-- not a tenant's own admin. Defaults false for every existing user;
-- grant it manually afterward to whichever account(s) should have it.
ALTER TABLE "users" ADD COLUMN "isPlatformSuperadmin" boolean NOT NULL DEFAULT false;
