-- Three standalone admin/PM-managed lookup tables: Issue Categories, Teams,
-- Labels/Tags. Not yet referenced by any other table (Issue.category is
-- still the existing hardcoded enum) - these are catalogs to be wired up
-- as real FKs in a later task.
CREATE TABLE "issue_categories" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying NOT NULL,
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "issue_categories"
  ADD CONSTRAINT "FK_issue_categories_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_issue_categories_tenant_name" ON "issue_categories" ("tenantId", "name");

CREATE TABLE "teams" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying NOT NULL,
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "teams"
  ADD CONSTRAINT "FK_teams_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_teams_tenant_name" ON "teams" ("tenantId", "name");

CREATE TABLE "labels" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "name" character varying NOT NULL,
  "description" text,
  "isActive" boolean NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "labels"
  ADD CONSTRAINT "FK_labels_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_labels_tenant_name" ON "labels" ("tenantId", "name");
