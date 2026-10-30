-- Rollback for 2026-11-performance-tracking-tech-reviews.sql. Drops the
-- technical reviews and their evidence (lost) and the 3 Q5 settings.
-- Deploy the previous code first.
BEGIN;
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "techReviewCriteria";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "techReviewsPerMonth";
ALTER TABLE "performance_tracking_settings" DROP COLUMN IF EXISTS "techReviewerUserIds";
DROP TABLE IF EXISTS "tech_review_evidence";
DROP TABLE IF EXISTS "tech_reviews";
COMMIT;
