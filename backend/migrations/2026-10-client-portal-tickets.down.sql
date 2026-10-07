-- Rollback for 2026-10-client-portal-tickets.sql: drops only what it
-- added (two new tables and the new portal-table columns). Ticket replies
-- and status history are lost; tickets themselves stay.
BEGIN;
DROP TABLE IF EXISTS "client_ticket_events";
DROP TABLE IF EXISTS "client_ticket_comments";
ALTER TABLE "client_tickets" DROP COLUMN IF EXISTS "lastActivityAt";
ALTER TABLE "client_tickets" DROP COLUMN IF EXISTS "expectedResult";
ALTER TABLE "client_tickets" DROP COLUMN IF EXISTS "stepsToReproduce";
ALTER TABLE "clients" DROP COLUMN IF EXISTS "ticketPrefix";
COMMIT;
