-- Rollback for 2026-11-performance-tracking-security-findings.sql. Drops
-- the security findings (lost) and the settings. Deploy the previous code
-- first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "securityMinSample";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "securityWindowDays";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "securityRoles";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "securitySlaDays";
DROP TABLE IF EXISTS "security_findings";
COMMIT;
