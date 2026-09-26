-- Release Log: a release (Project + App Name + Version + Release Date +
-- one Artifacts field for the whole release) with one row per ticket
-- (project task) shipped in it. Each row snapshots that task's Resolution
-- from its latest QA/Peer Review round at the time it was added, so the
-- log stays a fixed record of what shipped even if the task gets
-- resubmitted later.
--
-- Named `releases` (not `release_logs`) on purpose - this is meant to grow
-- into ReleaseBot's planned first-class Release entity (approval gate,
-- generated release notes), which dependencies.releaseId is already
-- waiting on. No FK from dependencies.releaseId yet - that's for later.
CREATE TABLE "releases" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "projectName" character varying NOT NULL,
  "appName" character varying NOT NULL,
  "version" character varying NOT NULL,
  "releaseDate" date NOT NULL,
  "artifacts" text,
  "createdByUserId" integer,
  "createdByEmail" character varying,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "releases"
  ADD CONSTRAINT "FK_releases_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");

CREATE UNIQUE INDEX "IDX_releases_project_app_version" ON "releases" ("tenantId", "projectId", "appName", "version");
CREATE INDEX "IDX_releases_tenant_date" ON "releases" ("tenantId", "releaseDate");

CREATE TABLE "release_items" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "releaseId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "taskTitle" character varying NOT NULL,
  "resolution" text,
  "sourceReviewId" integer,
  "addedByUserId" integer,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "release_items"
  ADD CONSTRAINT "FK_release_items_release" FOREIGN KEY ("releaseId") REFERENCES "releases"("id") ON DELETE CASCADE;
ALTER TABLE "release_items"
  ADD CONSTRAINT "FK_release_items_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id");

CREATE UNIQUE INDEX "IDX_release_items_release_task" ON "release_items" ("releaseId", "taskId");
