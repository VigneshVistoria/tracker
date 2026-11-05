-- Postgres can't remove a value from an enum type. To roll back: deploy the
-- previous code (it never offers these values). Only if no artifact uses
-- them does anything else matter; check with:
SELECT type, count(*) FROM task_qa_review_artifacts
 WHERE type IN ('Design file', 'Prototype', 'Design spec') GROUP BY type;
