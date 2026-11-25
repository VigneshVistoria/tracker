-- Requirements traceability, Stage 2 seed (2026-11-25): the Lien SRS's 5
-- open client items (SRS section 10, "to confirm at the client meeting"),
-- word for word from docs/samples/traceability-tree.html, each linked to
-- the stories it affects (7 links). All Open. While an item is open its
-- stories show as Blocked in the Requirements tree.
-- Needs 2026-11-requirements-s1.sql + its seed and 2026-11-requirements-s2.sql.
-- Safe to run twice: does nothing if the SRS already has client items.
BEGIN;
DO $seed$
DECLARE
  v_project integer := 6; -- SEED_PROJECT
  v_srs integer;
  v_tenant integer;
  v_item integer;
BEGIN
  SELECT id, "tenantId" INTO v_srs, v_tenant FROM srs_documents
    WHERE "projectId" = v_project AND name = 'Lien, Litigation & Court Collateral' AND version = '1.0' AND "deletedAt" IS NULL;
  IF v_srs IS NULL THEN RAISE EXCEPTION 'Lien SRS v1.0 not found for project %', v_project; END IF;
  IF EXISTS (SELECT 1 FROM srs_client_items WHERE "srsId" = v_srs) THEN
    RAISE NOTICE 'Client items already seeded for SRS % - nothing done', v_srs;
    RETURN;
  END IF;

  INSERT INTO srs_client_items ("tenantId", "srsId", number, question, baseline, owner) VALUES (v_tenant, v_srs, 1, 'Will banks and courts log records directly, or will client staff log them in-house?', 'Both supported through roles', 'Client') RETURNING id INTO v_item;
  INSERT INTO srs_client_item_stories ("itemId", "storyId") SELECT v_item, id FROM srs_stories WHERE "srsId" = v_srs AND "deletedAt" IS NULL AND code IN ('US-23');

  INSERT INTO srs_client_items ("tenantId", "srsId", number, question, baseline, owner) VALUES (v_tenant, v_srs, 2, 'Legal position on a relative or third party using the owner''s property, with consent', 'Supported, consent from every owner (LN-09 to LN-11)', 'Client / Legal') RETURNING id INTO v_item;
  INSERT INTO srs_client_item_stories ("itemId", "storyId") SELECT v_item, id FROM srs_stories WHERE "srsId" = v_srs AND "deletedAt" IS NULL AND code IN ('US-02');

  INSERT INTO srs_client_items ("tenantId", "srsId", number, question, baseline, owner) VALUES (v_tenant, v_srs, 3, 'Should a Historical Unregistered Lien block transfer, or only warn?', 'Block (parcel lock); can switch to warning', 'Client') RETURNING id INTO v_item;
  INSERT INTO srs_client_item_stories ("itemId", "storyId") SELECT v_item, id FROM srs_stories WHERE "srsId" = v_srs AND "deletedAt" IS NULL AND code IN ('US-08');

  INSERT INTO srs_client_items ("tenantId", "srsId", number, question, baseline, owner) VALUES (v_tenant, v_srs, 4, 'Master lists: lien types, case types, courts, banks, relationship values', 'Section 7 lists used as defaults', 'Client') RETURNING id INTO v_item;
  INSERT INTO srs_client_item_stories ("itemId", "storyId") SELECT v_item, id FROM srs_stories WHERE "srsId" = v_srs AND "deletedAt" IS NULL AND code IN ('US-01', 'US-11', 'US-13');

  INSERT INTO srs_client_items ("tenantId", "srsId", number, question, baseline, owner) VALUES (v_tenant, v_srs, 5, 'Plan to encourage registration of past properties (e.g. bank campaign)', 'Supported by the HL-05 report', 'Client') RETURNING id INTO v_item;
  INSERT INTO srs_client_item_stories ("itemId", "storyId") SELECT v_item, id FROM srs_stories WHERE "srsId" = v_srs AND "deletedAt" IS NULL AND code IN ('US-10');

  IF (SELECT count(*) FROM srs_client_items WHERE "srsId" = v_srs) <> 5 THEN RAISE EXCEPTION 'client items count'; END IF;
  IF (SELECT count(*) FROM srs_client_item_stories l JOIN srs_client_items i ON i.id = l."itemId" WHERE i."srsId" = v_srs) <> 7 THEN RAISE EXCEPTION 'client item links count'; END IF;
  RAISE NOTICE 'Client items seeded for SRS %: 5 items, 7 story links', v_srs;
END
$seed$;
COMMIT;
