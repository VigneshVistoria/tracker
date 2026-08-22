-- ReleaseBot Phase 0: foundations migration.
-- Adds the Program Manager role, the Dependency/Evidence/AuditLog tables,
-- and Issue.priority. Run this once against production BEFORE deploying
-- the Phase 0 application code (the code expects this schema to exist).
--
-- Order matters below, specifically around isProgramManager: the role
-- enum must be widened to include 'program_manager' and the data must be
-- migrated onto the new role value BEFORE the old isProgramManager column
-- is dropped - otherwise whoever currently holds that flag loses the
-- designation with no way to recover it.
--
-- Verified by generating this from TypeORM's own schema-diff tool against
-- a local Postgres 16 instance seeded with a test row that had
-- isProgramManager = true, then confirming (a) that test row's role
-- became 'program_manager' and (b) re-running the diff tool afterward
-- reported zero remaining changes - i.e. this SQL produces an identical
-- schema to what the new entities expect, with no data loss.

BEGIN;

-- --- New tables: dependencies, evidence, audit_logs ---

CREATE TYPE "public"."dependencies_priority_enum" AS ENUM('Critical', 'High', 'Medium', 'Low');
CREATE TYPE "public"."dependencies_status_enum" AS ENUM('Open', 'Under Review', 'Assigned', 'In Progress', 'Resolved', 'Closed', 'Blocked', 'Escalated');
CREATE TYPE "public"."dependencies_impactlevel_enum" AS ENUM('Critical', 'High', 'Medium', 'Low');
CREATE TABLE "dependencies" (
  "id" SERIAL NOT NULL,
  "title" character varying NOT NULL,
  "description" text NOT NULL,
  "blockingReason" text NOT NULL,
  "requestedTeam" character varying NOT NULL,
  "ownerUserId" integer,
  "ownerEmail" character varying NOT NULL,
  "priority" "public"."dependencies_priority_enum" NOT NULL,
  "requiredByDate" date NOT NULL,
  "impactedIssueId" integer NOT NULL,
  "releaseId" integer,
  "businessJustification" text NOT NULL,
  "status" "public"."dependencies_status_enum" NOT NULL DEFAULT 'Open',
  "impactLevel" "public"."dependencies_impactlevel_enum" NOT NULL,
  "blocking" boolean NOT NULL DEFAULT false,
  "estimatedDelayDays" integer,
  "createdByUserId" integer,
  "createdByEmail" character varying NOT NULL,
  "resolvedAt" TIMESTAMP,
  "escalatedAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_9f1f03f8207f8df418ae3eca645" PRIMARY KEY ("id")
);

CREATE TYPE "public"."evidence_type_enum" AS ENUM('SharePoint Link', 'OneDrive Link', 'Azure DevOps Link', 'Pull Request Link', 'Git Commit Link', 'Build Pipeline Link', 'Deployment Report', 'Functional Test Evidence', 'Screenshot', 'Demo Video', 'Technical Documentation');
CREATE TABLE "evidence" (
  "id" SERIAL NOT NULL,
  "issueId" integer NOT NULL,
  "title" character varying NOT NULL,
  "type" "public"."evidence_type_enum" NOT NULL,
  "url" text NOT NULL,
  "submittedByUserId" integer,
  "submittedByEmail" character varying NOT NULL,
  "comments" text,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_b864cb5d49854f89917fc0b44b9" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" SERIAL NOT NULL,
  "userId" integer,
  "userEmail" character varying,
  "userRole" character varying,
  "action" character varying NOT NULL,
  "entityType" character varying,
  "entityId" integer,
  "details" text,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_1bb179d048bbc581caa3b013439" PRIMARY KEY ("id")
);

-- --- Program Manager: widen the role enum, migrate the data, THEN drop the old flag ---

ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'developer', 'qa', 'executive', 'program_manager');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'developer';
DROP TYPE "public"."users_role_enum_old";

-- Preserve whoever currently holds the isProgramManager flag by moving
-- them onto the new role - must happen after the enum widen above and
-- before the column drop below.
UPDATE "users" SET "role" = 'program_manager' WHERE "isProgramManager" = true;

ALTER TABLE "users" DROP COLUMN "isProgramManager";

-- --- Issue.priority ---

CREATE TYPE "public"."issues_priority_enum" AS ENUM('Critical', 'High', 'Medium', 'Low');
ALTER TABLE "issues" ADD "priority" "public"."issues_priority_enum";

COMMIT;
