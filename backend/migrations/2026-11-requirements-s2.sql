-- Requirements traceability, Stage 2 (2026-11-25, plan approved by the user):
-- BA role, Epic / Story / Criteria editing, story approval with the client
-- sign-off gate, open client items, and ticket linking / mapping. Still
-- behind the "requirements_tree" switch. See backend/src/requirements/.
-- Additive only:
--   users_role_enum          + 'ba'. No existing user changes; only users an
--                              Admin assigns get BA, and only while the
--                              switch is ON (checked in the code).
--   srs_documents            + client sign-off: client name, sign-off date,
--                              the signed document (storage key, name, type,
--                              size), who recorded it and when. PM only.
--   srs_stories              + "Approve at risk" (flag, reason, who, when)
--                              + who deleted it
--   srs_epics, srs_criteria  + who deleted it
--   srs_ticket_criteria      - a linked ticket -> the criteria it covers
--   srs_client_items         - per-SRS open client items (question,
--                              baseline, owner, open/closed + resolution).
--                              Numbers are never reused
--   srs_client_item_stories  - client item -> stories it blocks while open
-- Data (the Lien SRS's 5 open items) is 2026-11-requirements-s2-seed.sql.
-- Run once (the apply script skips it if srs_client_items already exists).
-- Rollback: 2026-11-requirements-s2.down.sql (it cannot remove the 'ba'
-- enum value - Postgres does not allow that; see the down file).
BEGIN;

ALTER TYPE "public"."users_role_enum" ADD VALUE IF NOT EXISTS 'ba';

ALTER TABLE "srs_documents" ADD COLUMN "clientName" character varying(255) NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientSignedOn" date NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientFileKey" character varying(512) NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientFileName" character varying(255) NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientFileMime" character varying(120) NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientFileSize" integer NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientSignedByUserId" integer NULL;
ALTER TABLE "srs_documents" ADD COLUMN "clientSignedAt" TIMESTAMP NULL;
ALTER TABLE "srs_documents" ADD CONSTRAINT "CHK_srs_documents_client_signoff" CHECK (
  "status" <> 'client_signed_off' OR (
    "clientName" IS NOT NULL AND "clientSignedOn" IS NOT NULL AND "clientFileKey" IS NOT NULL AND "clientFileName" IS NOT NULL
    AND "clientFileMime" IS NOT NULL AND "clientFileSize" IS NOT NULL AND "clientSignedByUserId" IS NOT NULL AND "clientSignedAt" IS NOT NULL));

ALTER TABLE "srs_stories" ADD COLUMN "atRisk" boolean NOT NULL DEFAULT false;
ALTER TABLE "srs_stories" ADD COLUMN "atRiskReason" text NULL;
ALTER TABLE "srs_stories" ADD COLUMN "atRiskByUserId" integer NULL;
ALTER TABLE "srs_stories" ADD COLUMN "atRiskAt" TIMESTAMP NULL;
ALTER TABLE "srs_stories" ADD COLUMN "deletedByUserId" integer NULL;
ALTER TABLE "srs_stories" ADD CONSTRAINT "CHK_srs_stories_at_risk" CHECK (
  "atRisk" = false OR (length(btrim(coalesce("atRiskReason", ''))) >= 10 AND "atRiskByUserId" IS NOT NULL AND "atRiskAt" IS NOT NULL));

ALTER TABLE "srs_epics" ADD COLUMN "deletedByUserId" integer NULL;
ALTER TABLE "srs_criteria" ADD COLUMN "deletedByUserId" integer NULL;

CREATE TABLE "srs_ticket_criteria" (
  "storyTicketId" integer NOT NULL,
  "criterionId" integer NOT NULL,
  CONSTRAINT "PK_srs_ticket_criteria" PRIMARY KEY ("storyTicketId", "criterionId"),
  CONSTRAINT "FK_srs_ticket_criteria_link" FOREIGN KEY ("storyTicketId") REFERENCES "srs_story_tickets"("id") ON DELETE CASCADE,
  CONSTRAINT "FK_srs_ticket_criteria_criterion" FOREIGN KEY ("criterionId") REFERENCES "srs_criteria"("id")
);

CREATE TABLE "srs_client_items" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "srsId" integer NOT NULL,
  "number" integer NOT NULL,
  "question" text NOT NULL,
  "baseline" text NULL,
  "owner" character varying(255) NULL,
  "status" character varying(10) NOT NULL DEFAULT 'open',
  "resolution" text NULL,
  "closedByUserId" integer NULL,
  "closedAt" TIMESTAMP NULL,
  "createdByUserId" integer NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  "deletedByUserId" integer NULL,
  CONSTRAINT "PK_srs_client_items" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_client_items_number" UNIQUE ("srsId", "number"),
  CONSTRAINT "FK_srs_client_items_srs" FOREIGN KEY ("srsId") REFERENCES "srs_documents"("id"),
  CONSTRAINT "CHK_srs_client_items_status" CHECK ("status" IN ('open', 'closed')),
  CONSTRAINT "CHK_srs_client_items_number" CHECK ("number" > 0),
  CONSTRAINT "CHK_srs_client_items_closed" CHECK (
    "status" = 'open' OR (length(btrim(coalesce("resolution", ''))) >= 10 AND "closedByUserId" IS NOT NULL AND "closedAt" IS NOT NULL))
);

CREATE TABLE "srs_client_item_stories" (
  "itemId" integer NOT NULL,
  "storyId" integer NOT NULL,
  CONSTRAINT "PK_srs_client_item_stories" PRIMARY KEY ("itemId", "storyId"),
  CONSTRAINT "FK_srs_client_item_stories_item" FOREIGN KEY ("itemId") REFERENCES "srs_client_items"("id"),
  CONSTRAINT "FK_srs_client_item_stories_story" FOREIGN KEY ("storyId") REFERENCES "srs_stories"("id")
);
CREATE INDEX "IDX_srs_client_item_stories_story" ON "srs_client_item_stories" ("storyId");

COMMIT;
