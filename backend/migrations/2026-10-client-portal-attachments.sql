-- Client portal, Stage 3 (2026-10-07): ticket attachments. One new table -
-- nothing existing is altered. The files themselves live in the private
-- Supabase Storage bucket "client-portal-attachments" (not in this
-- database, so not in the nightly pg_dump). Run after
-- 2026-10-client-portal-tickets.sql.
BEGIN;

CREATE TABLE "client_ticket_attachments" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "ticketId" integer NOT NULL,
  "commentId" integer,
  "uploadedByUserId" integer NOT NULL,
  "fileName" character varying(200) NOT NULL,
  "mimeType" character varying(100) NOT NULL,
  "sizeBytes" integer NOT NULL,
  "storageKey" character varying(300) NOT NULL,
  "isInternal" boolean NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_ticket_attachments_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_ticket_attachments_ticket" FOREIGN KEY ("ticketId") REFERENCES "client_tickets"("id"),
  CONSTRAINT "FK_client_ticket_attachments_comment" FOREIGN KEY ("commentId") REFERENCES "client_ticket_comments"("id"),
  CONSTRAINT "FK_client_ticket_attachments_uploader" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id"),
  CONSTRAINT "UQ_client_ticket_attachments_key" UNIQUE ("storageKey")
);
CREATE INDEX "IDX_client_ticket_attachments_ticket" ON "client_ticket_attachments" ("ticketId", "createdAt");

COMMIT;
