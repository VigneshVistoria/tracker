-- Fixes the "Excessive QA Rejection Flag" being a flat 100%/0% penalty
-- switch (excessiveRejectionThreshold + qaRejectionWeight alone), which
-- made any rejection count past the threshold cost identically - 3
-- rejections and 30 rejections both landed the same -20 points, letting
-- assignees with many rejections still read as "Good". Adds a
-- points-per-rejection field so the penalty scales with how far past the
-- (still-configurable) grace threshold the count is, instead of tripping
-- one fixed penalty. Run this once against production BEFORE deploying
-- the application code that expects it.

ALTER TABLE "kpi_config" ADD COLUMN "qaRejectionPointsPerExcess" numeric(6,2) NOT NULL DEFAULT 30;
