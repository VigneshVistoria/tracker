-- Client portal, Stage 2 (2026-10-07): ticket conversation and history.
-- Two new tables plus new columns on the Stage 1 portal tables only -
-- nothing outside the client portal is altered, so LMS and every current
-- workflow are untouched. Run after 2026-10-client-portal-foundation.sql.
BEGIN;

-- Short code shown before a client's ticket numbers (Amanah -> AM-12).
ALTER TABLE "clients" ADD COLUMN "ticketPrefix" character varying(10) NOT NULL DEFAULT 'CT';

ALTER TABLE "client_tickets" ADD COLUMN "stepsToReproduce" text;
ALTER TABLE "client_tickets" ADD COLUMN "expectedResult" text;
ALTER TABLE "client_tickets" ADD COLUMN "lastActivityAt" TIMESTAMP NOT NULL DEFAULT now();

-- Replies on a ticket. isInternal = team-only note, never sent to client users.
CREATE TABLE "client_ticket_comments" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "ticketId" integer NOT NULL,
  "authorUserId" integer NOT NULL,
  "body" text NOT NULL,
  "isInternal" boolean NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_ticket_comments_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_ticket_comments_ticket" FOREIGN KEY ("ticketId") REFERENCES "client_tickets"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_client_ticket_comments_author" FOREIGN KEY ("authorUserId") REFERENCES "users"("id")
);
CREATE INDEX "IDX_client_ticket_comments_ticket" ON "client_ticket_comments" ("ticketId", "createdAt");

-- Status history: one row per create / status change / assignee change.
CREATE TABLE "client_ticket_events" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "ticketId" integer NOT NULL,
  "type" character varying(20) NOT NULL,
  "fromValue" character varying(40),
  "toValue" character varying(40),
  "actorUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_client_ticket_events_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_client_ticket_events_ticket" FOREIGN KEY ("ticketId") REFERENCES "client_tickets"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_client_ticket_events_actor" FOREIGN KEY ("actorUserId") REFERENCES "users"("id"),
  CONSTRAINT "CHK_client_ticket_events_type" CHECK ("type" IN ('created', 'status', 'assignee'))
);
CREATE INDEX "IDX_client_ticket_events_ticket" ON "client_ticket_events" ("ticketId", "createdAt");

UPDATE "clients" SET "ticketPrefix" = 'AM' WHERE "tenantId" = 1 AND "name" = 'Amanah Insurance';

COMMIT;
