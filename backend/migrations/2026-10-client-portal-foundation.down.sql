-- Rollback for 2026-10-client-portal-foundation.sql (drops only the new
-- portal tables; nothing else is touched).
BEGIN;
DROP TABLE IF EXISTS "client_requests";
DROP TABLE IF EXISTS "client_tickets";
DROP TABLE IF EXISTS "client_team_members";
DROP TABLE IF EXISTS "client_users";
DROP TABLE IF EXISTS "clients";
COMMIT;
