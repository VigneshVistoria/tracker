-- Requirements traceability, Stage 1 (2026-11-25, plan approved by the user):
-- SRS -> Epic -> User story -> Acceptance criteria -> linked tickets, the
-- Tree view and Pass/Fail. Everything is behind the "requirements_tree"
-- switch (team_settings."requirementsTree", OFF). See backend/src/requirements/.
-- Additive only - no existing table or row is changed, apart from the one
-- new team_settings column (default OFF).
--   srs_documents            - one SRS per project and version
--   srs_requirements         - requirement IDs (LN-01, NFR-1...). Unique per
--                              SRS INCLUDING soft-deleted rows, so an ID is
--                              never reused
--   srs_epics                - epic + its SRS section
--   srs_stories              - "As a / I want / so that", status
--   srs_story_requirements   - story -> requirement IDs it traces to
--   srs_criteria             - numbered acceptance criteria, current result
--   srs_criterion_results    - every Pass/Fail ever recorded. Append-only:
--                              a trigger refuses UPDATE and DELETE
--   srs_story_tickets        - story -> Tracker ticket (Dev / QA). Linking
--                              never writes to project_tasks
-- Rows are soft-deleted ("deletedAt"), never removed.
-- Data (the Lien SRS) is a separate file: 2026-11-requirements-s1-seed.sql.
-- Run once (the apply script skips it if srs_documents already exists).
-- Rollback: 2026-11-requirements-s1.down.sql.
BEGIN;

ALTER TABLE "team_settings" ADD COLUMN "requirementsTree" boolean NOT NULL DEFAULT false;

CREATE TABLE "srs_documents" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "lineageId" integer NULL,
  "name" character varying(255) NOT NULL,
  "version" character varying(20) NOT NULL,
  "issuedOn" date NULL,
  "reviewerUserIds" jsonb NOT NULL DEFAULT '[]',
  "status" character varying(20) NOT NULL DEFAULT 'draft',
  "signedOffByUserId" integer NULL,
  "signedOffAt" TIMESTAMP NULL,
  "createdByUserId" integer NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_srs_documents" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_documents_version" UNIQUE ("projectId", "name", "version"),
  CONSTRAINT "FK_srs_documents_project" FOREIGN KEY ("projectId") REFERENCES "projects"("id"),
  CONSTRAINT "CHK_srs_documents_status" CHECK ("status" IN ('draft', 'in_review', 'signed_off', 'client_signed_off'))
);
CREATE INDEX "IDX_srs_documents_project" ON "srs_documents" ("tenantId", "projectId");

CREATE TABLE "srs_requirements" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "srsId" integer NOT NULL,
  "sectionId" integer NULL,
  "code" character varying(20) NOT NULL,
  "prefix" character varying(10) NOT NULL,
  "seq" integer NOT NULL,
  "text" text NOT NULL,
  "priority" character varying(10) NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_srs_requirements" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_requirements_code" UNIQUE ("srsId", "code"),
  CONSTRAINT "UQ_srs_requirements_seq" UNIQUE ("srsId", "prefix", "seq"),
  CONSTRAINT "FK_srs_requirements_srs" FOREIGN KEY ("srsId") REFERENCES "srs_documents"("id"),
  CONSTRAINT "CHK_srs_requirements_priority" CHECK ("priority" IN ('high', 'medium', 'low')),
  CONSTRAINT "CHK_srs_requirements_seq" CHECK ("seq" > 0)
);

CREATE TABLE "srs_epics" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "srsId" integer NOT NULL,
  "code" character varying(20) NOT NULL,
  "name" character varying(255) NOT NULL,
  "srsSection" character varying(100) NULL,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_srs_epics" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_epics_code" UNIQUE ("srsId", "code"),
  CONSTRAINT "FK_srs_epics_srs" FOREIGN KEY ("srsId") REFERENCES "srs_documents"("id")
);

CREATE TABLE "srs_stories" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "srsId" integer NOT NULL,
  "epicId" integer NOT NULL,
  "code" character varying(20) NOT NULL,
  "title" character varying(255) NOT NULL,
  "asA" text NULL,
  "iWant" text NULL,
  "soThat" text NULL,
  "status" character varying(20) NOT NULL DEFAULT 'draft',
  "approvedByUserId" integer NULL,
  "approvedAt" TIMESTAMP NULL,
  "needsReview" boolean NOT NULL DEFAULT false,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdByUserId" integer NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_srs_stories" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_stories_code" UNIQUE ("srsId", "code"),
  CONSTRAINT "FK_srs_stories_srs" FOREIGN KEY ("srsId") REFERENCES "srs_documents"("id"),
  CONSTRAINT "FK_srs_stories_epic" FOREIGN KEY ("epicId") REFERENCES "srs_epics"("id"),
  CONSTRAINT "CHK_srs_stories_status" CHECK ("status" IN ('draft', 'approved', 'in_progress', 'done'))
);
CREATE INDEX "IDX_srs_stories_epic" ON "srs_stories" ("epicId");

CREATE TABLE "srs_story_requirements" (
  "storyId" integer NOT NULL,
  "requirementId" integer NOT NULL,
  CONSTRAINT "PK_srs_story_requirements" PRIMARY KEY ("storyId", "requirementId"),
  CONSTRAINT "FK_srs_story_requirements_story" FOREIGN KEY ("storyId") REFERENCES "srs_stories"("id"),
  CONSTRAINT "FK_srs_story_requirements_requirement" FOREIGN KEY ("requirementId") REFERENCES "srs_requirements"("id")
);
CREATE INDEX "IDX_srs_story_requirements_requirement" ON "srs_story_requirements" ("requirementId");

-- "resultBeforeApproval": the current result was recorded while the story
-- was still Draft (allowed in Stage 1; from Stage 2 only Approved stories
-- take results, and these keep a "recorded before approval" note).
CREATE TABLE "srs_criteria" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "storyId" integer NOT NULL,
  "position" integer NOT NULL,
  "text" text NOT NULL,
  "result" character varying(10) NOT NULL DEFAULT 'not_run',
  "resultNote" text NULL,
  "resultByUserId" integer NULL,
  "resultAt" TIMESTAMP NULL,
  "resultBeforeApproval" boolean NOT NULL DEFAULT false,
  "needsReview" boolean NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "deletedAt" TIMESTAMP NULL,
  CONSTRAINT "PK_srs_criteria" PRIMARY KEY ("id"),
  CONSTRAINT "FK_srs_criteria_story" FOREIGN KEY ("storyId") REFERENCES "srs_stories"("id"),
  CONSTRAINT "CHK_srs_criteria_result" CHECK ("result" IN ('not_run', 'pass', 'fail')),
  CONSTRAINT "CHK_srs_criteria_position" CHECK ("position" > 0),
  CONSTRAINT "CHK_srs_criteria_fail_note" CHECK ("result" <> 'fail' OR length(btrim(coalesce("resultNote", ''))) >= 10),
  CONSTRAINT "CHK_srs_criteria_result_by" CHECK ("result" = 'not_run' OR ("resultByUserId" IS NOT NULL AND "resultAt" IS NOT NULL))
);
CREATE INDEX "IDX_srs_criteria_story" ON "srs_criteria" ("storyId");

CREATE TABLE "srs_criterion_results" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "criterionId" integer NOT NULL,
  "storyId" integer NOT NULL,
  "result" character varying(10) NOT NULL,
  "note" text NULL,
  "storyStatus" character varying(20) NOT NULL,
  "beforeApproval" boolean NOT NULL,
  "recordedByUserId" integer NOT NULL,
  "recordedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_srs_criterion_results" PRIMARY KEY ("id"),
  CONSTRAINT "FK_srs_criterion_results_criterion" FOREIGN KEY ("criterionId") REFERENCES "srs_criteria"("id"),
  CONSTRAINT "CHK_srs_criterion_results_result" CHECK ("result" IN ('pass', 'fail')),
  CONSTRAINT "CHK_srs_criterion_results_fail_note" CHECK ("result" <> 'fail' OR length(btrim(coalesce("note", ''))) >= 10)
);
CREATE INDEX "IDX_srs_criterion_results_criterion" ON "srs_criterion_results" ("criterionId", "recordedAt");

CREATE FUNCTION tracker_srs_history_is_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'srs_criterion_results is append-only: history cannot be edited or deleted';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "TRG_srs_criterion_results_append_only"
  BEFORE UPDATE OR DELETE ON "srs_criterion_results"
  FOR EACH ROW EXECUTE FUNCTION tracker_srs_history_is_append_only();

CREATE TABLE "srs_story_tickets" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "storyId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "kind" character varying(5) NOT NULL,
  "linkedByUserId" integer NOT NULL,
  "linkedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_srs_story_tickets" PRIMARY KEY ("id"),
  CONSTRAINT "UQ_srs_story_tickets_link" UNIQUE ("storyId", "taskId", "kind"),
  CONSTRAINT "FK_srs_story_tickets_story" FOREIGN KEY ("storyId") REFERENCES "srs_stories"("id"),
  CONSTRAINT "FK_srs_story_tickets_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id") ON DELETE CASCADE,
  CONSTRAINT "CHK_srs_story_tickets_kind" CHECK ("kind" IN ('dev', 'qa'))
);
CREATE INDEX "IDX_srs_story_tickets_task" ON "srs_story_tickets" ("taskId");

COMMIT;
