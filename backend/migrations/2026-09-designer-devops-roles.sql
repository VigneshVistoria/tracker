-- Adds Designer and DevOps as real UserRole values, identical in
-- permission/visibility/behavior to Developer everywhere in the app
-- (see backend/src/users/user.entity.ts's DEVELOPER_EQUIVALENT_ROLES and
-- every call site that reads it). No existing rows change role - unlike
-- the Program Manager migration (phase0-releasebot-foundations.sql),
-- nobody currently holds either of these new values, so there's no data
-- migration step, just the enum widen.
--
-- Verified by generating this from TypeORM's own schema-diff tool against
-- a local Postgres 16 instance, then confirming re-running the diff tool
-- afterward reported zero remaining changes - i.e. this SQL produces an
-- identical schema to what the updated UserRole enum expects.

BEGIN;

ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'developer', 'qa', 'executive', 'program_manager', 'client', 'designer', 'devops');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'developer';
DROP TYPE "public"."users_role_enum_old";

COMMIT;
