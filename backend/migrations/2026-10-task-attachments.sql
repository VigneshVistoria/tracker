-- Defect screenshots (2026-10-12): files QA attaches to a defect, by paste
-- or screen capture on Create Defect. One new table - nothing existing is
-- altered. The files live in the private Supabase Storage bucket
-- "task-attachments" (same StorageService as client portal attachments;
-- not in this database, so not in the nightly pg_dump).
BEGIN;

CREATE TABLE "task_attachments" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "taskId" integer NOT NULL,
  "uploadedByUserId" integer NOT NULL,
  "fileName" character varying(200) NOT NULL,
  "mimeType" character varying(100) NOT NULL,
  "sizeBytes" integer NOT NULL,
  "storageKey" character varying(300) NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "FK_task_attachments_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id"),
  CONSTRAINT "FK_task_attachments_task" FOREIGN KEY ("taskId") REFERENCES "project_tasks"("id"),
  CONSTRAINT "FK_task_attachments_uploader" FOREIGN KEY ("uploadedByUserId") REFERENCES "users"("id"),
  CONSTRAINT "UQ_task_attachments_key" UNIQUE ("storageKey")
);
CREATE INDEX "IDX_task_attachments_task" ON "task_attachments" ("taskId", "createdAt");

COMMIT;
