ALTER TABLE "task_qa_reviews" ADD COLUMN "artifactType" task_qa_reviews_artifacttype_enum;
ALTER TABLE "task_qa_reviews" ADD COLUMN "artifactUrl" text;

-- Only the first artifact of any round that ended up with more than one
-- survives the downgrade - the old schema only ever had room for one.
UPDATE "task_qa_reviews" tr
SET "artifactType" = a."type", "artifactUrl" = a."url"
FROM (
  SELECT DISTINCT ON ("taskQaReviewId") "taskQaReviewId", "type", "url"
  FROM "task_qa_review_artifacts"
  ORDER BY "taskQaReviewId", "id"
) a
WHERE tr."id" = a."taskQaReviewId";

DROP INDEX IF EXISTS "IDX_task_qa_review_artifacts_review";
DROP TABLE IF EXISTS "task_qa_review_artifacts";
