-- Admin/PM-defined custom fields on test cases, plus labels on test
-- cases (reusing the existing tenant-wide `labels` catalog).
--
-- test_case_custom_fields holds the field definitions; each test case
-- stores its own values in test_cases."customFields" (jsonb, keyed by the
-- field's id as a string, so renaming a field never orphans its values).
-- test_cases."labelIds" is a plain integer[] of labels.id - no join table,
-- same "plain FK, no relation" shape the rest of test_cases uses.
-- Purely additive: existing rows get {} / '{}' and behave exactly as
-- before.
BEGIN;
CREATE TYPE "public"."test_case_custom_fields_fieldtype_enum" AS ENUM('Text', 'Number', 'Date', 'Dropdown');

CREATE TABLE "test_case_custom_fields" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying NOT NULL,
  "fieldType" "public"."test_case_custom_fields_fieldtype_enum" NOT NULL,
  "options" jsonb NOT NULL DEFAULT '[]',
  "isRequired" boolean NOT NULL DEFAULT false,
  "isActive" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "test_case_custom_fields"
  ADD CONSTRAINT "FK_test_case_custom_fields_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_test_case_custom_fields_tenant_name" ON "test_case_custom_fields" ("tenantId", lower("name"));

ALTER TABLE "test_cases" ADD COLUMN "customFields" jsonb NOT NULL DEFAULT '{}';
ALTER TABLE "test_cases" ADD COLUMN "labelIds" integer[] NOT NULL DEFAULT '{}';
COMMIT;
