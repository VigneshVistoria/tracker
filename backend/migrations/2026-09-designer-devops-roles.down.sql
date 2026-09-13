-- Reverses 2026-09-designer-devops-roles.sql. Safe only if no user
-- currently holds 'designer' or 'devops' - the guard below aborts the
-- transaction instead of silently reassigning real users' roles if it
-- would lose data, same caution as every other role-enum-narrowing
-- rollback in this folder would need.

BEGIN;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "users" WHERE "role" IN ('designer', 'devops')) THEN
    RAISE EXCEPTION 'Cannot roll back: at least one user holds the designer or devops role. Reassign them first.';
  END IF;
END $$;

ALTER TYPE "public"."users_role_enum" RENAME TO "users_role_enum_old";
CREATE TYPE "public"."users_role_enum" AS ENUM('admin', 'developer', 'qa', 'executive', 'program_manager', 'client');
ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "public"."users_role_enum" USING "role"::"text"::"public"."users_role_enum";
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'developer';
DROP TYPE "public"."users_role_enum_old";

COMMIT;
