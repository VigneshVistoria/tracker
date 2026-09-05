DROP INDEX IF EXISTS "IDX_evidence_batch";
ALTER TABLE "evidence" DROP COLUMN IF EXISTS "batchId";
