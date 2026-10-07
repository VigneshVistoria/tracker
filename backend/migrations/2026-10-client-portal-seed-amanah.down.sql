-- Rollback for 2026-10-client-portal-seed-amanah.sql: removes only the
-- Amanah portal configuration rows from the new portal tables. No existing
-- table (users, projects, modules, LMS data) is touched. Team and client-
-- user rows go with the client via ON DELETE CASCADE. Fails (and changes
-- nothing) if Amanah already has portal tickets or requests - drop those
-- deliberately first rather than losing them by accident.
BEGIN;
DELETE FROM "clients" WHERE "tenantId" = 1 AND "name" = 'Amanah Insurance';
COMMIT;
