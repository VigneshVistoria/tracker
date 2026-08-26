-- Schema additions for the Performance Tracking Dashboard: Issue gets
-- reopen/late-dependency tracking columns, plus two new tables for the
-- admin-editable scoring configuration. Run this once against production
-- BEFORE deploying the application code that expects it - same rule as
-- every prior migration in this folder.

BEGIN;

-- --- Issue: reopen count + late-dependency attribution ---

ALTER TABLE "issues" ADD "reopenedCount" integer NOT NULL DEFAULT 0;
ALTER TABLE "issues" ADD "wasCreatedMidDevelopment" boolean;
ALTER TABLE "issues" ADD "lateDependencyAttributedToUserId" integer;

-- --- Performance Scoring Configuration ---

CREATE TYPE "public"."performance_scoring_config_overduepenaltymode_enum" AS ENUM('Tiered', 'Flat');
CREATE TABLE "performance_scoring_config" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "overduePenaltyMode" "public"."performance_scoring_config_overduepenaltymode_enum" NOT NULL DEFAULT 'Tiered',
  "flatOverduePenaltyPercent" integer NOT NULL DEFAULT 10,
  "qaFailedWeightPercent" integer NOT NULL DEFAULT 15,
  "reopenedWeightPercent" integer NOT NULL DEFAULT 10,
  "lateDependencyWeightPercent" integer NOT NULL DEFAULT 10,
  "earlyCompletionBonusPercent" integer NOT NULL DEFAULT 5,
  "updatedByUserId" integer,
  "updatedByEmail" character varying,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Singleton row - PerformanceScoringService always reads/updates this
-- one row (with a defensive fallback if it's ever missing).
INSERT INTO "performance_scoring_config" DEFAULT VALUES;

CREATE TABLE "overdue_penalty_tiers" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "minDaysLate" integer NOT NULL,
  "maxDaysLate" integer,
  "penaltyPercent" integer NOT NULL,
  "sortOrder" integer NOT NULL DEFAULT 0
);

-- Starting defaults - fully editable from the Performance Scoring
-- Configuration page from this point on.
INSERT INTO "overdue_penalty_tiers" ("minDaysLate", "maxDaysLate", "penaltyPercent", "sortOrder") VALUES
  (1, 3, 5, 1),
  (4, 7, 10, 2),
  (8, NULL, 20, 3);

COMMIT;
