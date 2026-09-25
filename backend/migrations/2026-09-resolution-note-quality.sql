-- Adds task_qa_reviews.noteQualityFlagged/noteQualityReason, both
-- nullable. Populated asynchronously (fire-and-forget, never blocking a
-- submission) by NoteQualityService after TaskQaReviewsService.submit()/
-- PeerReviewsService.submit() create a review row, via a free-tier Gemini
-- call gated by an in-process rate limiter (see note-quality.service.ts).
-- NULL means "not checked yet" (feature disabled, rate-limited, or the
-- Gemini call failed) - distinct from `false` ("checked, not vague") so
-- NonComplianceReportService can tell "clean" apart from "unchecked" when
-- computing the checked/flagged counts for the Vague/Poor Resolution
-- Notes dimension. Existing rows stay NULL - nothing backfills them.
ALTER TABLE "task_qa_reviews" ADD COLUMN "noteQualityFlagged" boolean;
ALTER TABLE "task_qa_reviews" ADD COLUMN "noteQualityReason" text;
