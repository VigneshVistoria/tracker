-- Performance Tracking Q5 - technical review (2026-10-30, fast-track; the
-- open rules are settings with defaults, listed for the Technical
-- Director in /home/ec2-user/perf-tracking-defaults.md). See
-- backend/src/tech-reviews/tech-reviews.ts. Additive only.
--   tech_reviews - one reviewed item of a person's work, scored 1-5 per
--     rubric item (scores jsonb, average), in a tracked project, for a
--     month. Never deleted.
--   tech_review_evidence - the append-only evidence log of a review.
--   performance_tracking_settings."techReviewerUserIds" (named reviewers;
--     set to [3] - Abdirahman, Technical Director - when user #3 exists,
--     with an audit entry), "techReviewsPerMonth" (2) and
--     "techReviewCriteria" (the rubric).
-- Run once (the apply script skips it if tech_reviews already exists).
-- Rollback: 2026-11-performance-tracking-tech-reviews.down.sql.
BEGIN;

CREATE TABLE "tech_reviews" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "revieweeUserId" integer NOT NULL,
  "reviewerUserId" integer NOT NULL,
  "month" character varying(7) NOT NULL,
  "itemTitle" character varying(200) NOT NULL,
  "taskId" integer NULL,
  "itemLink" character varying(500) NULL,
  "scores" jsonb NOT NULL,
  "average" numeric(4,2) NOT NULL,
  "comment" text NULL,
  "reviewedAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tech_reviews" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_tech_reviews_month" CHECK ("month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  CONSTRAINT "CHK_tech_reviews_average" CHECK ("average" BETWEEN 1 AND 5),
  CONSTRAINT "CHK_tech_reviews_not_self" CHECK ("revieweeUserId" <> "reviewerUserId")
);
CREATE INDEX "IDX_tech_reviews_month" ON "tech_reviews" ("tenantId", "month", "revieweeUserId");
CREATE INDEX "IDX_tech_reviews_project" ON "tech_reviews" ("tenantId", "projectId", "reviewedAt");

CREATE TABLE "tech_review_evidence" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "reviewId" integer NOT NULL,
  "note" text NOT NULL,
  "link" character varying(500) NULL,
  "addedByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_tech_review_evidence" PRIMARY KEY ("id"),
  CONSTRAINT "FK_tech_review_evidence_review" FOREIGN KEY ("reviewId") REFERENCES "tech_reviews"("id") ON DELETE CASCADE
);
CREATE INDEX "IDX_tech_review_evidence_review" ON "tech_review_evidence" ("reviewId");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "techReviewerUserIds" jsonb NOT NULL DEFAULT '[]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "techReviewsPerMonth" integer NOT NULL DEFAULT 2;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "techReviewCriteria" jsonb NOT NULL
  DEFAULT '["Code quality", "Design and architecture", "Testing", "Security", "Documentation"]';

-- The Technical Director (#3) reviews, as for score overrides (B4).
INSERT INTO "performance_tracking_settings" ("tenantId", "techReviewerUserIds")
SELECT u."tenantId", '[3]'::jsonb FROM "users" u WHERE u.id = 3
ON CONFLICT ("tenantId") DO UPDATE SET "techReviewerUserIds" = '[3]'::jsonb, "updatedAt" = now();
INSERT INTO "audit_logs" ("userId", "userEmail", "userRole", "action", "entityType", "entityId", "details", "createdAt", "tenantId")
SELECT NULL, 'migration 2026-11-performance-tracking-tech-reviews', NULL, 'performance_tracking_settings_updated', 'PerformanceTrackingSettings', u."tenantId",
       '{"source":"migration","instructedBy":"Vignesh Selvaraj (#4), 2026-10-30","change":{"techReviewerUserIds":{"before":[],"after":[3]}},"note":"Technical reviews by #3 Abdirahman, Technical Director; add an architect on the settings screen"}',
       now(), u."tenantId"
  FROM "users" u WHERE u.id = 3;

COMMIT;
