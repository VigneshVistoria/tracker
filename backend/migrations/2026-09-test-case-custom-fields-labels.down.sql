-- Reverses 2026-09-test-case-custom-fields-labels.sql. Drops every custom
-- field definition and value, and every label assignment on test cases.
BEGIN;
ALTER TABLE "test_cases" DROP COLUMN "labelIds";
ALTER TABLE "test_cases" DROP COLUMN "customFields";
DROP TABLE "test_case_custom_fields";
DROP TYPE "public"."test_case_custom_fields_fieldtype_enum";
COMMIT;
