-- Undo 2026-10-refresh-sessions.sql. Web users then simply sign in again
-- when their current access token expires.
BEGIN;
DROP TABLE IF EXISTS "refresh_sessions";
COMMIT;
