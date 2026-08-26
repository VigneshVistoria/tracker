-- Schema additions for three new Tracker features: the project drill-down
-- (project -> module -> issue), the QA Test Case catalog with run
-- tracking, and the "received dependencies" inbox. Run this once against
-- production BEFORE deploying the application code that expects it - same
-- rule as phase0-releasebot-foundations.sql. Without this, TypeORM's
-- Issue entity declares moduleId/moduleName columns that don't exist yet,
-- which breaks every issue query, not just the new features.
--
-- The Dependency inbox feature needs no schema change at all - it reads
-- the existing issues.parentIssueId/assigneeUserId columns - so nothing
-- below is specific to it.

BEGIN;

-- --- Project drill-down: modules table + issues.moduleId/moduleName ---

CREATE TABLE "modules" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "projectId" integer NOT NULL,
  "projectName" character varying,
  "name" character varying NOT NULL,
  "description" text,
  "createdByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "issues" ADD "moduleId" integer;
ALTER TABLE "issues" ADD "moduleName" character varying;

-- --- QA Test Cases: catalog + run history ---

CREATE TYPE "public"."test_cases_priority_enum" AS ENUM('Critical', 'High', 'Medium', 'Low');
CREATE TYPE "public"."test_cases_category_enum" AS ENUM('New Feature', 'Enhancement', 'Bug', 'Critical', 'Showstopper', 'Defect');
CREATE TYPE "public"."test_cases_status_enum" AS ENUM('Active', 'Deprecated');
CREATE TYPE "public"."test_executions_result_enum" AS ENUM('Passed', 'Failed', 'Blocked');

CREATE TABLE "test_cases" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "title" character varying NOT NULL,
  "description" text,
  "preconditions" text,
  "steps" text NOT NULL,
  "expectedResult" text NOT NULL,
  "priority" "public"."test_cases_priority_enum",
  "category" "public"."test_cases_category_enum",
  "projectId" integer,
  "projectName" character varying,
  "status" "public"."test_cases_status_enum" NOT NULL DEFAULT 'Active',
  "createdByUserId" integer,
  "createdByEmail" character varying,
  "lastResult" "public"."test_executions_result_enum",
  "lastExecutedAt" TIMESTAMP,
  "lastExecutedByEmail" character varying,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- test_cases.lastResult references this type, so it must already exist
-- by this point - it does, created above.
CREATE TABLE "test_executions" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "testCaseId" integer NOT NULL,
  "testCaseTitle" character varying,
  "projectId" integer,
  "projectName" character varying,
  "result" "public"."test_executions_result_enum" NOT NULL,
  "notes" text,
  "defectIssueId" integer,
  "executedByUserId" integer,
  "executedByEmail" character varying,
  "executedAt" TIMESTAMP NOT NULL DEFAULT now()
);

COMMIT;
