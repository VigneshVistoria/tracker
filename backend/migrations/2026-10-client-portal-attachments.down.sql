-- Rollback for 2026-10-client-portal-attachments.sql: drops the attachment
-- records only. The stored files stay in the "client-portal-attachments"
-- bucket and must be removed there separately if no longer wanted.
BEGIN;
DROP TABLE IF EXISTS "client_ticket_attachments";
COMMIT;
