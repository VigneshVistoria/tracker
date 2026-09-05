-- Multi-artifact Evidence submission: one selected Artifact Type per row
-- (unchanged), but rows from the same submission now share a batchId so
-- the viewer can group them back into one dated submission with several
-- artifacts instead of rendering N unrelated rows.

ALTER TABLE "evidence" ADD COLUMN "batchId" uuid;

CREATE INDEX "IDX_evidence_batch" ON "evidence" ("batchId");
