-- Schema additions for the Client role, SLA configuration/tracking, and
-- showstopper classification review. Run this once against production
-- BEFORE deploying the application code that expects it - same rule as
-- the earlier migrations in this folder. synchronize is off, so without
-- this the app crashes on any query touching the new issues columns.
--
-- Order matters for the role enum widen below, same reasoning as
-- phase0-releasebot-foundations.sql's program_manager addition: widen
-- the enum, then the column can safely be set to the new value later (no
-- existing rows need migrating here since nobody has 'client' yet).

BEGIN;

-- --- Feature 1: Client role ---

ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'developer', 'qa', 'executive', 'program_manager', 'client');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'developer';
DROP TYPE "public"."users_role_enum_old";

-- --- Feature 2: SLA configuration ---

CREATE TYPE "public"."sla_configs_key_enum" AS ENUM('Showstopper', 'Critical', 'High', 'Medium', 'Low', 'Default');
CREATE TABLE "sla_configs" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "key" "public"."sla_configs_key_enum" NOT NULL UNIQUE,
  "targetHours" integer NOT NULL,
  "updatedByUserId" integer,
  "updatedByEmail" character varying,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

-- Starting defaults - every value here is admin-editable from the SLA
-- Configuration page from this point on, nothing is hardcoded in
-- application logic.
INSERT INTO "sla_configs" ("key", "targetHours") VALUES
  ('Showstopper', 4),
  ('Critical', 8),
  ('High', 24),
  ('Medium', 72),
  ('Low', 120),
  ('Default', 72);

-- --- Feature 4: showstopper classification review ---

CREATE TYPE "public"."issues_showstopperreviewstatus_enum" AS ENUM('Pending', 'Confirmed', 'Downgraded');
ALTER TABLE "issues" ADD "showstopperReviewStatus" "public"."issues_showstopperreviewstatus_enum";
ALTER TABLE "issues" ADD "showstopperFlagReasons" text;
ALTER TABLE "issues" ADD "showstopperReviewedByUserId" integer;
ALTER TABLE "issues" ADD "showstopperReviewedByEmail" character varying;
ALTER TABLE "issues" ADD "showstopperReviewedAt" TIMESTAMP;

COMMIT;
