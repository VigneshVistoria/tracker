-- Rollback for 2026-10-project-timeline-ticket-links.sql. Roll the app back
-- first (the ticket-link endpoints need the table), then drop it. Past
-- adds/removals stay in audit_logs.
BEGIN;
DROP TABLE "project_timeline_ticket_links";
COMMIT;
