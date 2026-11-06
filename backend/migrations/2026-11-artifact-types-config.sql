-- Admin-configurable artifact types, Stage 1 (2026-11-06, decisions
-- confirmed with the user). Adds the tables only - no code reads them yet,
-- so nothing visible changes. Scope: the submission artifact types
-- (Ready for Feedback / Peer Review, TaskArtifactType). QA's own evidence
-- types (task_qa_review_qa_artifacts / task_defect_artifacts) are untouched.
--   artifact_types - one row per type per tenant. "code" is fixed forever
--     and is what artifact rows store; "label" is what users see and is
--     editable. Types are deactivated, never deleted, so history stays valid.
--     Seeded with the 10 current values (code = label = the stored value).
--   artifact_type_rules - per role (developer / designer / devops): which
--     types the role sees, and whether each one is required or optional.
--     Required applies at Ready for Feedback and Peer Review. Seeded EMPTY:
--     a role with no rules sees every active type, all optional, so
--     nothing becomes required until it's set on the Admin screen.
--   task_qa_review_artifacts.type - enum -> varchar(60) so new types need
--     no migration. Stored values are unchanged. The old enum type is kept
--     (unused) for the rollback.
-- Safe to run twice. Rollback: 2026-11-artifact-types-config.down.sql.
BEGIN;

CREATE TABLE IF NOT EXISTS "artifact_types" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "code" varchar(60) NOT NULL,
  "label" varchar(60) NOT NULL,
  "active" boolean NOT NULL DEFAULT true,
  "sortOrder" integer NOT NULL DEFAULT 0,
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_artifact_types_tenant_code" UNIQUE ("tenantId", "code"),
  CONSTRAINT "CHK_artifact_types_label" CHECK (length(btrim("label")) > 0)
);

CREATE TABLE IF NOT EXISTS "artifact_type_rules" (
  "id" SERIAL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "artifactTypeId" integer NOT NULL REFERENCES "artifact_types"("id") ON DELETE CASCADE,
  "role" varchar(30) NOT NULL,
  "requirement" varchar(10) NOT NULL DEFAULT 'optional',
  "updatedAt" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "UQ_artifact_type_rules_type_role" UNIQUE ("artifactTypeId", "role"),
  CONSTRAINT "CHK_artifact_type_rules_requirement" CHECK ("requirement" IN ('optional', 'required')),
  CONSTRAINT "CHK_artifact_type_rules_role" CHECK ("role" IN ('developer', 'designer', 'devops'))
);
CREATE INDEX IF NOT EXISTS "IDX_artifact_type_rules_tenant_role" ON "artifact_type_rules" ("tenantId", "role");

INSERT INTO "artifact_types" ("tenantId", "code", "label", "sortOrder")
SELECT t."id", v.code, v.code, v.ord
  FROM "tenants" t
 CROSS JOIN (VALUES
   ('APK Build', 1), ('Build Pipeline Link', 2), ('Deployment Report', 3),
   ('Pull Request Link', 4), ('Screenshot', 5), ('Demo Video', 6),
   ('Technical Documentation', 7), ('Design file', 8), ('Prototype', 9),
   ('Design spec', 10)
 ) AS v(code, ord)
ON CONFLICT ("tenantId", "code") DO NOTHING;

ALTER TABLE "task_qa_review_artifacts" ALTER COLUMN "type" TYPE varchar(60) USING "type"::text;

COMMIT;
