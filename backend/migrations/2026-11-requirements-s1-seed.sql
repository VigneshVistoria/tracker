-- Requirements traceability, Stage 1 seed (2026-11-25): the real SRS
-- "Lien, Litigation & Court Collateral" v1.0 for the LMS project (#6), taken
-- word for word from docs/samples/traceability-tree.html:
--   40 requirements, 6 epics, 23 user stories, 65 acceptance criteria,
--   41 story -> requirement links.
-- SRS status In review (not yet client-signed), issued 16-11-2026, the one
-- reviewer = the Program Manager Vignesh (looked up by role + name; stops if
-- there is not exactly one match). Every story Draft, every criterion
-- Not run. NO example progress, tickets, names or fails.
-- Needs 2026-11-requirements-s1.sql first. Safe to run twice: does nothing
-- if this SRS version already exists for the project.
-- Rollback: delete via 2026-11-requirements-s1.down.sql (drops everything).
BEGIN;
DO $seed$
DECLARE
  v_project integer := 6; -- SEED_PROJECT
  v_reviewer_pattern text := 'Vignesh%'; -- SEED_REVIEWER
  v_tenant integer;
  v_reviewer integer;
  v_count integer;
  v_srs integer;
  v_epic integer;
  v_story integer;
BEGIN
  SELECT "tenantId" INTO v_tenant FROM projects WHERE id = v_project;
  IF v_tenant IS NULL THEN RAISE EXCEPTION 'Project % not found', v_project; END IF;
  IF EXISTS (SELECT 1 FROM srs_documents WHERE "projectId" = v_project AND name = 'Lien, Litigation & Court Collateral' AND version = '1.0') THEN
    RAISE NOTICE 'Lien SRS v1.0 already seeded for project % - nothing done', v_project;
    RETURN;
  END IF;
  SELECT count(*), min(id) INTO v_count, v_reviewer FROM users
    WHERE "tenantId" = v_tenant AND role::text = 'program_manager' AND "fullName" ILIKE v_reviewer_pattern;
  IF v_count <> 1 THEN RAISE EXCEPTION 'Expected exactly 1 Program Manager matching %, found %', v_reviewer_pattern, v_count; END IF;

  INSERT INTO srs_documents ("tenantId", "projectId", name, version, "issuedOn", "reviewerUserIds", status)
  VALUES (v_tenant, v_project, 'Lien, Litigation & Court Collateral', '1.0', DATE '2026-11-16', jsonb_build_array(v_reviewer), 'in_review')
  RETURNING id INTO v_srs;

  INSERT INTO srs_requirements ("tenantId", "srsId", code, prefix, seq, text, priority, "sortOrder") VALUES
  (v_tenant, v_srs, 'LN-01', 'LN', 1, 'A formal lien can be recorded only against a registered title deed; title deed reference is mandatory', 'high', 1),
  (v_tenant, v_srs, 'LN-02', 'LN', 2, 'Ownership is verified against the title deed register before approval', 'high', 2),
  (v_tenant, v_srs, 'LN-03', 'LN', 3, 'For past liens on unregistered properties, guide the user to register the property first', 'high', 3),
  (v_tenant, v_srs, 'LN-04', 'LN', 4, 'An approved, active lien applies a deed lock that blocks transfer or sale', 'high', 4),
  (v_tenant, v_srs, 'LN-05', 'LN', 5, 'Lien release; after approval the lock is removed', 'high', 5),
  (v_tenant, v_srs, 'LN-06', 'LN', 6, 'More than one lien on the same title deed, each with its own priority order', 'medium', 6),
  (v_tenant, v_srs, 'LN-07', 'LN', 7, 'Past start date allowed for existing liens', 'high', 7),
  (v_tenant, v_srs, 'LN-08', 'LN', 8, 'Record title deed owner(s) and customer (borrower) separately', 'high', 8),
  (v_tenant, v_srs, 'LN-09', 'LN', 9, 'Record the relationship between owner and customer', 'high', 9),
  (v_tenant, v_srs, 'LN-10', 'LN', 10, 'If the customer is not the owner, a signed, verified owner consent document is mandatory', 'high', 10),
  (v_tenant, v_srs, 'LN-11', 'LN', 11, 'Consent required from every owner of a co-owned property', 'high', 11),
  (v_tenant, v_srs, 'LN-12', 'LN', 12, 'All owners and the customer are notified on approval and release', 'medium', 12),
  (v_tenant, v_srs, 'HL-01', 'HL', 1, 'Record historical liens against property/parcel ID and coordinates, without a title deed', 'high', 13),
  (v_tenant, v_srs, 'HL-02', 'HL', 2, 'Label "Historical – Unregistered" and keep separate from formal liens', 'high', 14),
  (v_tenant, v_srs, 'HL-03', 'HL', 3, 'Approved record applies a parcel lock and shows on the map viewer', 'high', 15),
  (v_tenant, v_srs, 'HL-04', 'HL', 4, 'Convert to a formal lien when the property is registered, keeping full history', 'high', 16),
  (v_tenant, v_srs, 'HL-05', 'HL', 5, 'Report of unregistered historical liens for bank follow-up', 'medium', 17),
  (v_tenant, v_srs, 'LT-01', 'LT', 1, 'Create, view, update and close litigation records against a property', 'high', 18),
  (v_tenant, v_srs, 'LT-02', 'LT', 2, 'Title deed optional; otherwise recorded against parcel ID and coordinates', 'high', 19),
  (v_tenant, v_srs, 'LT-03', 'LT', 3, '"Blocked from transfer" = Yes applies a deed or parcel lock on approval', 'high', 20),
  (v_tenant, v_srs, 'LT-04', 'LT', 4, 'Past filing date allowed for existing cases', 'high', 21),
  (v_tenant, v_srs, 'LT-05', 'LT', 5, 'Closing a case removes the lock unless another active record exists', 'high', 22),
  (v_tenant, v_srs, 'CC-01', 'CC', 1, 'Record a property pledged as court collateral, linked to the court case', 'high', 23),
  (v_tenant, v_srs, 'CC-02', 'CC', 2, 'Record surety, accused/defendant and their relationship', 'high', 24),
  (v_tenant, v_srs, 'CC-03', 'CC', 3, 'Approved collateral applies a deed or parcel lock until court release', 'high', 25),
  (v_tenant, v_srs, 'CC-04', 'CC', 4, 'Only an approved court release order removes the lock', 'high', 26),
  (v_tenant, v_srs, 'CC-05', 'CC', 5, 'Forfeiture sets status Forfeited; lock stays', 'high', 27),
  (v_tenant, v_srs, 'CC-06', 'CC', 6, 'Collateral shown as a separate map viewer layer', 'medium', 28),
  (v_tenant, v_srs, 'CM-01', 'CM', 1, 'Mobile app Yes/No question; Yes flags the property for office verification', 'high', 29),
  (v_tenant, v_srs, 'CM-02', 'CM', 2, 'Verification officer checks the physical file and logs a verified record', 'high', 30),
  (v_tenant, v_srs, 'CM-03', 'CM', 3, 'Upload supporting documents (PDF or image) on every record', 'high', 31),
  (v_tenant, v_srs, 'CM-04', 'CM', 4, 'Request a surveyor to collect coordinates or boundaries', 'medium', 32),
  (v_tenant, v_srs, 'CM-05', 'CM', 5, 'Map layers: Lien, Historical Unregistered Lien, Litigation, Court Collateral', 'medium', 33),
  (v_tenant, v_srs, 'CM-06', 'CM', 6, 'Transfer or sale of a locked property is blocked and active records are shown', 'high', 34),
  (v_tenant, v_srs, 'CM-07', 'CM', 7, 'Search and report by status, bank, court, case number, owner, customer and date', 'medium', 35),
  (v_tenant, v_srs, 'CM-08', 'CM', 8, 'Audit trail for create, update, approve, reject, release and convert', 'high', 36),
  (v_tenant, v_srs, 'NFR-1', 'NFR', 1, 'Role-based access: banks see only their liens; court users only litigation and collateral', 'high', 37),
  (v_tenant, v_srs, 'NFR-2', 'NFR', 2, 'Record history kept and cannot be edited', 'high', 38),
  (v_tenant, v_srs, 'NFR-3', 'NFR', 3, 'Personal details visible only to authorised roles', 'high', 39),
  (v_tenant, v_srs, 'NFR-4', 'NFR', 4, 'Mobile question must not slow down field collection', 'medium', 40);

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E1', 'Formal lien', 'SRS 4.1, 4.3, 4.4', 1) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-01', 'Record a formal lien against a registered title deed', 'bank officer', 'to record a lien against a registered title deed with the customer and loan details', 'the bank''s security is on record against the verified owner', 1) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'The title deed reference is mandatory and must exist in the title deed register'),
    (v_tenant, v_story, 2, 'Owner(s) are filled from the title deed; the customer is recorded separately'),
    (v_tenant, v_story, 3, 'A past start date can be entered for existing liens'),
    (v_tenant, v_story, 4, 'The lien cannot be approved until ownership is verified'),
    (v_tenant, v_story, 5, 'Lien type, lender, amount and currency, priority and documents are mandatory (SRS 7.1)');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-01', 'LN-02', 'LN-07', 'LN-08');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-02', 'Capture relationship and owner consent', 'bank officer', 'to record how the customer is related to the owner and upload the owner''s consent', 'a relative or partner can use the property as security legally', 2) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Relationship list: Self, Spouse, Parent, Child, Sibling, Other relative, Business partner, Other'),
    (v_tenant, v_story, 2, 'If relationship is not Self, a signed consent document is mandatory'),
    (v_tenant, v_story, 3, 'For co-owned property, consent is required from every owner'),
    (v_tenant, v_story, 4, 'The verification officer must mark each consent as verified before approval');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-09', 'LN-10', 'LN-11');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-03', 'Approve a lien and apply the deed lock', 'approver', 'to approve or reject a lien with a reason', 'an approved lien blocks transfer or sale of the property', 3) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Approval applies a deed lock; rejection requires a reason'),
    (v_tenant, v_story, 2, 'A transfer or sale attempt on the deed is blocked and the active lien is shown'),
    (v_tenant, v_story, 3, 'All owners and the customer are notified on approval');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-04', 'LN-12');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-04', 'Record a second lien with priority order', 'bank officer', 'to add a second charge on the same title deed', 'each lender''s rank is clear', 4) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'More than one active lien is allowed on a title deed'),
    (v_tenant, v_story, 2, 'Each lien has a priority number (1 = first charge) and duplicates are refused');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-06');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-05', 'Release a lien when the loan is repaid', 'bank officer', 'to request release of a lien', 'the owner can sell or transfer the property again', 5) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'The bank submits a release request with a document'),
    (v_tenant, v_story, 2, 'After approval the status becomes Released'),
    (v_tenant, v_story, 3, 'The deed lock is removed only if no other active record exists'),
    (v_tenant, v_story, 4, 'Owners and the customer are notified on release');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-05', 'LN-12');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-06', 'Guide past liens to register the property first', 'bank officer', 'to be guided to register an unregistered property before recording its past lien', 'ownership can be verified (preferred route)', 6) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'If the property has no registered title deed, the screen explains the registration route first'),
    (v_tenant, v_story, 2, 'The user can still choose the Historical Unregistered Lien register (US-07)');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LN-03');

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E2', 'Historical unregistered lien', 'SRS 4.2', 2) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-07', 'Record a historical lien without a title deed', 'bank officer', 'to record an old lien against a parcel and its coordinates', 'existing liens are captured even before the property is registered', 7) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Parcel ID and coordinates are mandatory; title deed is not'),
    (v_tenant, v_story, 2, 'Records are labelled "Historical – Unregistered" everywhere'),
    (v_tenant, v_story, 3, 'They are kept separate from formal liens in screens and reports'),
    (v_tenant, v_story, 4, 'Original start date (past) is mandatory');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('HL-01', 'HL-02');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-08', 'Lock the parcel and show it on the map', 'approver', 'an approved historical lien to lock the parcel', 'the land cannot be transferred while the lien exists', 8) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Approval applies a parcel lock (configurable to warning only, open item 3)'),
    (v_tenant, v_story, 2, 'The record appears on the Historical Unregistered Lien map layer');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('HL-03');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-09', 'Convert to a formal lien when the property is registered', 'verification officer', 'to convert a historical lien once a title deed is registered', 'it becomes a formal lien without losing history', 9) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Conversion links the new title deed number'),
    (v_tenant, v_story, 2, 'Status becomes "Converted to formal lien" and full history is kept'),
    (v_tenant, v_story, 3, 'The parcel lock becomes a deed lock');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('HL-04');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-10', 'Follow-up report of unregistered historical liens', 'bank officer', 'a list of my unregistered historical liens', 'I can encourage customers to register', 10) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Report lists active unregistered liens by bank, with age and customer'),
    (v_tenant, v_story, 2, 'Exportable to Excel');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('HL-05');

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E3', 'Litigation', 'SRS 5.1', 3) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-11', 'Record a litigation case with or without a title deed', 'court officer', 'to record a court case against a property', 'disputed properties are known', 11) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Title deed is optional; parcel ID and coordinates are used if none'),
    (v_tenant, v_story, 2, 'Case number, court, parties, case type and filing date are mandatory'),
    (v_tenant, v_story, 3, 'A past filing date is allowed'),
    (v_tenant, v_story, 4, 'Records can be viewed, updated and closed');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LT-01', 'LT-02', 'LT-04');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-12', 'Lock a property under litigation and unlock on closure', 'approver', 'cases marked "Blocked from transfer" to lock the property', 'it cannot be sold during the case', 12) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, '"Blocked from transfer" = Yes applies a deed lock, or a parcel lock if there is no deed'),
    (v_tenant, v_story, 2, 'Closing the case (after approval) removes the lock'),
    (v_tenant, v_story, 3, 'The lock stays if another active record exists on the property');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('LT-03', 'LT-05');

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E4', 'Court collateral', 'SRS 5.2', 4) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-13', 'Record a property pledged as court collateral', 'court officer', 'to record a property pledged as bail or court security', 'the court''s security is on record', 13) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Linked to the court case number and court'),
    (v_tenant, v_story, 2, 'Surety (owner), accused and their relationship are mandatory'),
    (v_tenant, v_story, 3, 'Court order reference and date are mandatory');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CC-01', 'CC-02');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-14', 'Lock collateral until release or forfeiture', 'approver', 'collateral to stay locked until the court decides', 'pledged property cannot be sold', 14) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Approval applies a deed or parcel lock'),
    (v_tenant, v_story, 2, 'Only an approved court release order (reference and date) removes the lock'),
    (v_tenant, v_story, 3, 'Forfeiture sets status Forfeited and the lock stays');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CC-03', 'CC-04', 'CC-05');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-15', 'Show court collateral on the map', 'verification officer', 'collateral properties as their own map layer', 'they are easy to spot', 15) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Separate Court Collateral layer, can be switched on and off');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CC-06');

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E5', 'Common: field flag, locks, map, documents, audit', 'SRS 6', 5) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-16', 'Flag a property from the field and verify it in the office', 'field surveyor', 'to answer one Yes/No question', 'properties with a lien, case or collateral are checked in the office', 16) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Mobile app shows only the Yes/No question (no details captured)'),
    (v_tenant, v_story, 2, 'Yes flags the property for office verification'),
    (v_tenant, v_story, 3, 'The verification officer can open flagged properties and log the correct record type'),
    (v_tenant, v_story, 4, 'The question adds no noticeable delay to field collection');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-01', 'CM-02', 'NFR-4');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-17', 'Upload documents and request coordinates', 'officer', 'to attach documents and ask a surveyor for coordinates', 'every record is complete', 17) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'PDF or image upload on every record type'),
    (v_tenant, v_story, 2, 'A request for coordinates or boundaries can be sent to a surveyor');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-03', 'CM-04');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-18', 'Map viewer layers', 'user', 'to see lien, historical lien, litigation and collateral layers', 'I can see encumbrances on the map', 18) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Four layers, each can be switched on and off'),
    (v_tenant, v_story, 2, 'Clicking a property shows its active records');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-05');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-19', 'Block transfer or sale of a locked property', 'registry officer', 'transfers of locked properties to be blocked', 'no encumbered property is sold by mistake', 19) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Any transfer or sale attempt on a locked deed or parcel is refused'),
    (v_tenant, v_story, 2, 'The message lists the active lien, case or collateral records');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-06');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-20', 'Search and reports', 'supervisor', 'to search and report on all records', 'I can follow up', 20) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Search by status, bank, court, case number, owner, customer and date'),
    (v_tenant, v_story, 2, 'Results exportable to Excel');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-07');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-21', 'Audit trail', 'auditor', 'a full history of every action', 'nothing can be changed without a trace', 21) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Create, update, approve, reject, release and convert are all logged with user and time'),
    (v_tenant, v_story, 2, 'History cannot be edited or deleted');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('CM-08', 'NFR-2');

  INSERT INTO srs_epics ("tenantId", "srsId", code, name, "srsSection", "sortOrder") VALUES (v_tenant, v_srs, 'E6', 'Security and access', 'SRS 3, 9', 6) RETURNING id INTO v_epic;
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-22', 'Protect personal details', 'system administrator', 'owner, customer and surety details shown only to authorised roles', 'personal data is protected', 22) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Personal details are hidden from roles without permission'),
    (v_tenant, v_story, 2, 'Access is logged');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('NFR-3');
  INSERT INTO srs_stories ("tenantId", "srsId", "epicId", code, title, "asA", "iWant", "soThat", "sortOrder") VALUES (v_tenant, v_srs, v_epic, 'US-23', 'Role-based access for banks and courts', 'system administrator', 'banks to see only their own liens and court users only litigation and collateral', 'each organisation sees only its records', 23) RETURNING id INTO v_story;
  INSERT INTO srs_criteria ("tenantId", "storyId", position, text) VALUES
    (v_tenant, v_story, 1, 'Roles: Field surveyor, Verification officer, Bank officer, Court officer, Approver, System administrator'),
    (v_tenant, v_story, 2, 'A bank officer sees only liens of their bank'),
    (v_tenant, v_story, 3, 'Court officers see only litigation and collateral'),
    (v_tenant, v_story, 4, 'Works whether banks/courts log directly or client staff log in-house (open item 1)');
  INSERT INTO srs_story_requirements ("storyId", "requirementId") SELECT v_story, id FROM srs_requirements WHERE "srsId" = v_srs AND code IN ('NFR-1');

  -- Counts must match exactly, or nothing is kept.
  IF (SELECT count(*) FROM srs_requirements WHERE "srsId" = v_srs) <> 40 THEN RAISE EXCEPTION 'requirements count'; END IF;
  IF (SELECT count(*) FROM srs_epics WHERE "srsId" = v_srs) <> 6 THEN RAISE EXCEPTION 'epics count'; END IF;
  IF (SELECT count(*) FROM srs_stories WHERE "srsId" = v_srs) <> 23 THEN RAISE EXCEPTION 'stories count'; END IF;
  IF (SELECT count(*) FROM srs_criteria c JOIN srs_stories s ON s.id = c."storyId" WHERE s."srsId" = v_srs) <> 65 THEN RAISE EXCEPTION 'criteria count'; END IF;
  IF (SELECT count(*) FROM srs_story_requirements l JOIN srs_stories s ON s.id = l."storyId" WHERE s."srsId" = v_srs) <> 41 THEN RAISE EXCEPTION 'links count'; END IF;
  RAISE NOTICE 'Lien SRS v1.0 seeded: srs id %, project %, reviewer user %', v_srs, v_project, v_reviewer;
END
$seed$;
COMMIT;
