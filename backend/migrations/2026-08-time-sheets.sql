-- Time Sheets: Developer/Admin log time against a ticket or a project,
-- Admin/Executive/Program Manager view an aggregated report.
CREATE TABLE "time_entries" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "userEmail" character varying NOT NULL,
  "issueId" integer,
  "issueTitle" character varying,
  "projectId" integer,
  "projectName" character varying,
  "date" date NOT NULL,
  "hours" numeric(5,2) NOT NULL,
  "notes" text,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "time_entries"
  ADD CONSTRAINT "FK_time_entries_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE INDEX "IDX_time_entries_tenant_user_date" ON "time_entries" ("tenantId", "userId", "date");
CREATE INDEX "IDX_time_entries_tenant_project" ON "time_entries" ("tenantId", "projectId");
