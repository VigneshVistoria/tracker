-- Performance Tracking P3/P4 - security findings, entered by hand
-- (2026-10-30, fast-track; the scanner and its severity mapping are not
-- decided, so scanner import can come later). The open rules are settings
-- with defaults, listed for the Technical Director in /home/ec2-user/perf-
-- tracking-defaults.md. See backend/src/security-findings/security-findings.ts.
-- Additive only.
--   security_findings - one finding: tracked project (task optional),
--     severity, owner (charged), found/due day (SLA working days by
--     severity: the finding's own SLA, shown), assigned day + owner due
--     day (SLA from assignment to the current owner - what P4 charges;
--     reassignment restarts it), status open -> fix_submitted -> verified (or back to
--     open) / risk_accepted, first verification result for P3, the passing
--     fix's submission time for P4. Never deleted.
--   performance_tracking_settings."securitySlaDays" (2/5/10/20 working
--     days), "securityRoles" (who records and verifies: Admin, Program
--     Manager, QA), "securityWindowDays" (90), "securityMinSample" (3).
-- Run once (the apply script skips it if security_findings already exists).
-- Rollback: 2026-11-performance-tracking-security-findings.down.sql.
BEGIN;

CREATE TABLE "security_findings" (
  "id" SERIAL NOT NULL,
  "tenantId" integer NOT NULL,
  "projectId" integer NOT NULL,
  "taskId" integer NULL,
  "title" character varying(200) NOT NULL,
  "severity" character varying(10) NOT NULL,
  "source" character varying(100) NULL,
  "details" text NULL,
  "ownerUserId" integer NOT NULL,
  "foundOn" date NOT NULL,
  "dueOn" date NOT NULL,
  "assignedOn" date NOT NULL,
  "ownerDueOn" date NOT NULL,
  "status" character varying(20) NOT NULL DEFAULT 'open',
  "fixSubmittedAt" TIMESTAMP NULL,
  "fixNote" text NULL,
  "verifyAttempts" integer NOT NULL DEFAULT 0,
  "firstVerifyResult" character varying(10) NULL,
  "firstVerifiedAt" TIMESTAMP NULL,
  "fixedAt" TIMESTAMP NULL,
  "verifiedAt" TIMESTAMP NULL,
  "verifiedByUserId" integer NULL,
  "riskAcceptedAt" TIMESTAMP NULL,
  "riskAcceptedByUserId" integer NULL,
  "riskReason" text NULL,
  "createdByUserId" integer NOT NULL,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
  "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
  CONSTRAINT "PK_security_findings" PRIMARY KEY ("id"),
  CONSTRAINT "CHK_security_findings_severity" CHECK ("severity" IN ('critical', 'high', 'medium', 'low')),
  CONSTRAINT "CHK_security_findings_status" CHECK ("status" IN ('open', 'fix_submitted', 'verified', 'risk_accepted')),
  CONSTRAINT "CHK_security_findings_first_verify" CHECK ("firstVerifyResult" IS NULL OR "firstVerifyResult" IN ('passed', 'failed')),
  CONSTRAINT "CHK_security_findings_due" CHECK ("dueOn" >= "foundOn"),
  CONSTRAINT "CHK_security_findings_owner_due" CHECK ("ownerDueOn" >= "assignedOn"),
  CONSTRAINT "CHK_security_findings_verified" CHECK (("status" = 'verified') = ("verifiedAt" IS NOT NULL)),
  CONSTRAINT "CHK_security_findings_risk" CHECK (("status" = 'risk_accepted') = ("riskAcceptedAt" IS NOT NULL))
);
CREATE INDEX "IDX_security_findings_project" ON "security_findings" ("tenantId", "projectId");
CREATE INDEX "IDX_security_findings_owner" ON "security_findings" ("tenantId", "ownerUserId");

ALTER TABLE "performance_tracking_settings" ADD COLUMN "securitySlaDays" jsonb NOT NULL DEFAULT '{"critical": 2, "high": 5, "medium": 10, "low": 20}';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "securityRoles" jsonb NOT NULL DEFAULT '["admin", "program_manager", "qa"]';
ALTER TABLE "performance_tracking_settings" ADD COLUMN "securityWindowDays" integer NOT NULL DEFAULT 90;
ALTER TABLE "performance_tracking_settings" ADD COLUMN "securityMinSample" integer NOT NULL DEFAULT 3;

COMMIT;
