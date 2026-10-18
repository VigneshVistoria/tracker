-- Undo 2026-10-qa-review-attachments.sql. The stored image files stay in
-- the task-attachments bucket (under <tenant>/<task>/qa-review-<round>/)
-- and can be removed there separately.
BEGIN;
DROP TABLE IF EXISTS "task_qa_review_attachments";
COMMIT;
