-- Rollback for 2026-11-artifact-types-config.sql. Deploy the previous code
-- first. Fails (and changes nothing) if any artifact row uses a type added
-- on the Admin screen that the old enum doesn't have - delete or retype
-- those rows first.
BEGIN;
ALTER TABLE "task_qa_review_artifacts" ALTER COLUMN "type" TYPE task_qa_reviews_artifacttype_enum USING "type"::task_qa_reviews_artifacttype_enum;
DROP TABLE IF EXISTS "artifact_type_rules";
DROP TABLE IF EXISTS "artifact_types";
COMMIT;
