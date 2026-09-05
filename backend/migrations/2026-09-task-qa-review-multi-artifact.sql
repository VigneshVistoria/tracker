-- Multi-artifact Task QA submission: a "Ready for Feedback" submission
-- can now include several Artifact Type+URL pairs instead of exactly
-- one. Mirrors the Evidence feature's batchId-per-submission shape, but
-- scoped to a QA review round (one row per round already groups a
-- submission) rather than needing a separate batchId column - each
-- artifact row just points at the review round it belongs to.

CREATE TABLE "task_qa_review_artifacts" (
  "id" SERIAL PRIMARY KEY,
  "taskQaReviewId" integer NOT NULL,
  "type" task_qa_reviews_artifacttype_enum NOT NULL,
  "url" text NOT NULL
);

CREATE INDEX "IDX_task_qa_review_artifacts_review" ON "task_qa_review_artifacts" ("taskQaReviewId");

-- Carry every existing round's single artifact forward as that round's
-- one artifact row, so no submission history is lost.
INSERT INTO "task_qa_review_artifacts" ("taskQaReviewId", "type", "url")
SELECT "id", "artifactType", "artifactUrl" FROM "task_qa_reviews";

ALTER TABLE "task_qa_reviews" DROP COLUMN "artifactType";
ALTER TABLE "task_qa_reviews" DROP COLUMN "artifactUrl";
