-- Modules: adds a deactivate-instead-of-delete flag, and a uniqueness
-- guard on (projectId, name) - verified zero existing duplicate pairs
-- before adding this constraint.
ALTER TABLE "modules" ADD COLUMN "isActive" boolean NOT NULL DEFAULT true;

CREATE UNIQUE INDEX "IDX_modules_project_name" ON "modules" ("projectId", "name");
