-- Rollback for 2026-11-requirements-s2.sql (and its seed). Deploy the
-- Stage 1 code first. Drops the client items, ticket-criteria links, client
-- sign-off and at-risk columns, including anything recorded since.
--
-- The 'ba' value stays in users_role_enum: Postgres cannot remove an enum
-- value. It is harmless unused, but the Stage 1 code does not know the
-- role, so first make sure nobody holds it:
--   SELECT id, email FROM users WHERE role = 'ba';   -- must return 0 rows
-- (change those users' role in Admin -> Users before rolling back).
BEGIN;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM users WHERE role::text = 'ba') THEN
    RAISE EXCEPTION 'Some users still have the BA role - change their role first';
  END IF;
END $$;
DROP TABLE IF EXISTS "srs_client_item_stories";
DROP TABLE IF EXISTS "srs_client_items";
DROP TABLE IF EXISTS "srs_ticket_criteria";
ALTER TABLE "srs_criteria" DROP COLUMN IF EXISTS "deletedByUserId";
ALTER TABLE "srs_epics" DROP COLUMN IF EXISTS "deletedByUserId";
ALTER TABLE "srs_stories" DROP CONSTRAINT IF EXISTS "CHK_srs_stories_at_risk";
ALTER TABLE "srs_stories" DROP COLUMN IF EXISTS "deletedByUserId";
ALTER TABLE "srs_stories" DROP COLUMN IF EXISTS "atRiskAt";
ALTER TABLE "srs_stories" DROP COLUMN IF EXISTS "atRiskByUserId";
ALTER TABLE "srs_stories" DROP COLUMN IF EXISTS "atRiskReason";
ALTER TABLE "srs_stories" DROP COLUMN IF EXISTS "atRisk";
-- A client-signed SRS goes back to In review (Stage 1 has no client sign-off).
UPDATE "srs_documents" SET "status" = 'in_review' WHERE "status" = 'client_signed_off';
ALTER TABLE "srs_documents" DROP CONSTRAINT IF EXISTS "CHK_srs_documents_client_signoff";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientSignedAt";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientSignedByUserId";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientFileSize";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientFileMime";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientFileName";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientFileKey";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientSignedOn";
ALTER TABLE "srs_documents" DROP COLUMN IF EXISTS "clientName";
COMMIT;
