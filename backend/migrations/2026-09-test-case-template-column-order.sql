-- Admin/PM-chosen column order for the test case bulk import template
-- and export. One row per tenant; "columnOrder" lists column keys in
-- display order - built-in columns by name ('title', 'steps', ...) and
-- custom fields as 'cf:<id>', so renaming a field keeps its position.
-- Import matches headers by name, so order never affects importing.
-- Purely additive: a tenant with no row keeps the default order
-- (built-ins, then custom fields by sortOrder).
BEGIN;
CREATE TABLE "test_case_template_settings" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "columnOrder" jsonb NOT NULL DEFAULT '[]',
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "test_case_template_settings"
  ADD CONSTRAINT "FK_test_case_template_settings_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_test_case_template_settings_tenant" ON "test_case_template_settings" ("tenantId");
COMMIT;
