-- Demo data for product presentation - all issues title-prefixed "[DEMO] "
-- for easy identification/removal (see remove-demo-data.sql). Additive
-- only - no existing rows are touched. Real users (ids below) are used
-- as assignees/creators per user request; the two demo.client tickets
-- use the dedicated demo Client account (id looked up below) since no
-- real Client-role user exists.
--
-- Real user ids: 1=admin(test@gmail.com) 2=assignee_one(dev)
-- 3=abdirahman(exec) 4=vignesh(pm) 8=divyashree(qa) 9=bhavani(dev)
-- 10=salman(dev) 11=talha(dev) 12=abdirazak(dev)
-- Demo project ids: 24=Retail POS Revamp 25=Mobile Banking App
-- 26=Internal Analytics Portal
-- Demo module ids: 3=Checkout Flow 4=Inventory Sync 5=Receipt Printing
-- (all in project 24); 6=Authentication 7=Transactions (both in project 25)

BEGIN;

-- ===== [DEMO] Retail POS Revamp (project 24) =====

-- Backlog
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Add barcode scanner support for new hardware', 'New checkout terminals ship with a different scanner model - need driver support added.', 'Backlog', 4, 'vignesh.selvaraj@vistoriasystems.com', 2, 'assignee@gmail.com', 24, '[DEMO] Retail POS Revamp', 4, 'Inventory Sync', 'New Feature', 'Medium', 'Manual', false, now() - interval '5 days', now() - interval '5 days'),
('[DEMO] Refactor checkout state machine', 'Current checkout flow has grown hard to extend - propose a cleaner state machine.', 'Backlog', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'Enhancement', 'Low', 'Manual', false, now() - interval '12 days', now() - interval '12 days'),
('[DEMO] Support split tender payments', 'Customers want to pay part card, part cash on a single transaction.', 'Backlog', 4, 'vignesh.selvaraj@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'New Feature', 'High', 'Manual', false, now() - interval '3 days', now() - interval '3 days'),
('[DEMO] Investigate slow receipt print on thermal printers', 'Some stores report a 3-4 second delay before the receipt starts printing.', 'Backlog', 8, 'divyashree.sampathkumar@vistoriasystems.com', 12, 'agil.ali@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 5, 'Receipt Printing', 'Bug', 'Medium', 'Manual', false, now() - interval '8 days', now() - interval '8 days');

-- In Progress
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Implement offline mode for checkout', 'Store internet drops occasionally - checkout should queue transactions and sync once back online.', 'In Progress', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'New Feature', 'High', 'Manual', false, now() - interval '20 days', now() - interval '4 days'),
('[DEMO] Sync inventory counts every 5 minutes', 'Move from hourly batch sync to a 5-minute near-real-time sync job.', 'In Progress', 4, 'vignesh.selvaraj@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 4, 'Inventory Sync', 'Enhancement', 'Medium', 'Manual', false, now() - interval '15 days', now() - interval '2 days'),
('[DEMO] Fix receipt printer paper jam false positive', 'Printer reports a jam even when paper is loaded correctly on certain models.', 'In Progress', 8, 'divyashree.sampathkumar@vistoriasystems.com', 12, 'agil.ali@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 5, 'Receipt Printing', 'Bug', 'Medium', 'Manual', false, now() - interval '10 days', now() - interval '1 days'),
('[DEMO] checkout button color inconsistent - showstopper??', 'The pay button is a slightly different shade of blue than the rest of the UI on the new checkout screen.', 'In Progress', 4, 'vignesh.selvaraj@vistoriasystems.com', 2, 'assignee@gmail.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'Enhancement', 'Low', 'Manual', true, now() - interval '2 days', now() - interval '2 days');

-- In Review
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "submittedForReviewAt", "createdAt", "updatedAt") VALUES
('[DEMO] Add loyalty card scan to checkout flow', 'Scan a loyalty card barcode at checkout to auto-apply the customer''s point balance.', 'In Review', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'New Feature', 'Medium', 'Manual', false, now() - interval '1 days', now() - interval '18 days', now() - interval '1 days'),
('[DEMO] Improve inventory sync error handling', 'Sync job silently drops rows that fail validation - should log and retry instead.', 'In Review', 8, 'divyashree.sampathkumar@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 4, 'Inventory Sync', 'Defect', 'Medium', 'Manual', false, now() - interval '1 days', now() - interval '14 days', now() - interval '1 days');

-- QA Testing
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "submittedForReviewAt", "reviewedByUserId", "reviewedByEmail", "reviewedAt", "createdAt", "updatedAt") VALUES
('[DEMO] Add support for gift card balance check', 'Let cashiers check a gift card''s remaining balance without redeeming it.', 'QA Testing', 4, 'vignesh.selvaraj@vistoriasystems.com', 12, 'agil.ali@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'New Feature', 'High', 'Manual', false, now() - interval '3 days', 4, 'vignesh.selvaraj@vistoriasystems.com', now() - interval '2 days', now() - interval '22 days', now() - interval '2 days');

-- QA Failed (reopened once)
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "reopenedCount", "qaReviewedByUserId", "qaReviewedByEmail", "qaReviewedAt", "lastRejectionReason", "createdAt", "updatedAt") VALUES
('[DEMO] Receipt totals rounding incorrectly', 'Totals are off by a cent on receipts with 3+ discounted line items.', 'QA Failed', 4, 'vignesh.selvaraj@vistoriasystems.com', 2, 'assignee@gmail.com', 24, '[DEMO] Retail POS Revamp', 5, 'Receipt Printing', 'Defect', 'High', 'Manual', false, 1, 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '3 days', 'Rounding is still wrong when a discount and a coupon are combined.', now() - interval '25 days', now() - interval '3 days');

-- Ready for Production (one on-time, one closed late)
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "closedOn", "qaReviewedByUserId", "qaReviewedByEmail", "qaReviewedAt", "createdAt", "updatedAt") VALUES
('[DEMO] Add SKU lookup autocomplete', 'Type-ahead search when manually entering a SKU at checkout.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'Enhancement', 'Low', 'Manual', false, now() - interval '33 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '33 days', now() - interval '40 days', now() - interval '33 days'),
('[DEMO] Fix inventory count going negative on returns', 'Processing a return on an already-zero item drives the count negative instead of clamping at 0.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 4, 'Inventory Sync', 'Bug', 'High', 'Manual', false, now() - interval '20 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '20 days', now() - interval '38 days', now() - interval '20 days');

-- ===== [DEMO] Mobile Banking App (project 25) =====

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Add fingerprint login for Android', 'Android users want fingerprint unlock, matching the existing iOS Face ID support.', 'Backlog', 4, 'vignesh.selvaraj@vistoriasystems.com', 11, 'talha.siddiqu@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 6, 'Authentication', 'New Feature', 'Medium', 'Manual', false, now() - interval '6 days', now() - interval '6 days'),
('[DEMO] Critical outage - payments failing for all users in production', 'Every payment attempt in production is failing with a timeout. Customers cannot complete transactions. Blocking all users.', 'In Progress', 3, 'abdirahman.hassan@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'Defect', 'Critical', 'Manual', true, now() - interval '1 days', now() - interval '1 days'),
('[DEMO] Implement biometric login', 'Add Face ID / fingerprint as a login option ahead of the fingerprint-login backlog item.', 'In Progress', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 6, 'Authentication', 'New Feature', 'High', 'Manual', false, now() - interval '16 days', now() - interval '3 days');

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "submittedForReviewAt", "createdAt", "updatedAt") VALUES
('[DEMO] Add transaction category tagging', 'Auto-tag transactions (groceries, utilities, etc.) using the merchant name.', 'In Review', 4, 'vignesh.selvaraj@vistoriasystems.com', 11, 'talha.siddiqu@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'Enhancement', 'Medium', 'Manual', false, now() - interval '1 days', now() - interval '9 days', now() - interval '1 days');

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "reopenedCount", "qaReviewedByUserId", "qaReviewedByEmail", "qaReviewedAt", "lastRejectionReason", "createdAt", "updatedAt") VALUES
('[DEMO] Session timeout not clearing sensitive data', 'Balance and account number stay visible on screen after an idle session times out.', 'QA Failed', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 6, 'Authentication', 'Bug', 'High', 'Manual', false, 1, 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '4 days', 'Data still visible for about a second before the lock screen covers it - needs to clear first.', now() - interval '11 days', now() - interval '4 days');

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "closedOn", "qaReviewedByUserId", "qaReviewedByEmail", "qaReviewedAt", "createdAt", "updatedAt") VALUES
('[DEMO] Add biometric login for iOS', 'Face ID support for the iOS app login screen.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 6, 'Authentication', 'New Feature', 'High', 'Manual', false, now() - interval '40 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '40 days', now() - interval '44 days', now() - interval '40 days'),
('[DEMO] Fix transaction history pagination bug', 'Scrolling past 50 transactions duplicates the last page of results.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'Bug', 'Medium', 'Manual', false, now() - interval '30 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '30 days', now() - interval '35 days', now() - interval '30 days'),
('[DEMO] Add scheduled transfers', 'Let customers schedule a one-time or recurring transfer for a future date.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 11, 'talha.siddiqu@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'New Feature', 'Medium', 'Manual', false, now() - interval '25 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '25 days', now() - interval '30 days', now() - interval '25 days'),
('[DEMO] Improve login error messaging', 'Show a specific reason (wrong password vs. locked account) instead of a generic error.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 10, 'salman.ahmed@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 6, 'Authentication', 'Enhancement', 'Low', 'Manual', false, now() - interval '24 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '24 days', now() - interval '28 days', now() - interval '24 days'),
('[DEMO] Fix balance rounding on transfer confirmation', 'Confirmation screen shows a balance rounded differently than the final receipt.', 'Ready for Production', 4, 'vignesh.selvaraj@vistoriasystems.com', 9, 'bhavani.elumalai@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'Defect', 'Medium', 'Manual', false, now() - interval '12 days', 8, 'divyashree.sampathkumar@vistoriasystems.com', now() - interval '12 days', now() - interval '26 days', now() - interval '12 days');

-- ===== [DEMO] Internal Analytics Portal (project 26, no modules yet) =====

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Define KPI schema for dashboard v1', 'Agree on the initial set of KPIs and their definitions before building anything.', 'Backlog', 3, 'abdirahman.hassan@vistoriasystems.com', 2, 'assignee@gmail.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'Medium', 'Manual', false, now() - interval '4 days', now() - interval '4 days'),
('[DEMO] Evaluate charting library options', 'Compare a couple of charting approaches before committing to one.', 'Backlog', 3, 'abdirahman.hassan@vistoriasystems.com', 11, 'talha.siddiqu@vistoriasystems.com', 26, '[DEMO] Internal Analytics Portal', 'Enhancement', 'Low', 'Manual', false, now() - interval '7 days', now() - interval '7 days'),
('[DEMO] Scope data warehouse connector', 'Figure out what it takes to pull data from the existing warehouse into this portal.', 'Backlog', 3, 'abdirahman.hassan@vistoriasystems.com', 12, 'agil.ali@vistoriasystems.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'Medium', 'Manual', false, now() - interval '5 days', now() - interval '5 days'),
('[DEMO] Draft access control model for reports', 'Some reports should be role-restricted (e.g. financial ones to Admin/Exec only).', 'Backlog', 1, 'test@gmail.com', 1, 'test@gmail.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'High', 'Manual', false, now() - interval '2 days', now() - interval '2 days'),
('[DEMO] Review analytics data governance policy', 'Confirm what data this portal is allowed to surface before development starts.', 'Backlog', 1, 'test@gmail.com', 1, 'test@gmail.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'Medium', 'Manual', false, now() - interval '1 days', now() - interval '1 days');

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Build initial ETL pipeline prototype', 'Rough prototype moving one data source end to end, to validate the approach.', 'In Progress', 3, 'abdirahman.hassan@vistoriasystems.com', 2, 'assignee@gmail.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'Medium', 'Manual', false, now() - interval '13 days', now() - interval '3 days'),
('[DEMO] Set up analytics database schema', 'Base schema for the warehouse-backed reporting tables.', 'In Progress', 3, 'abdirahman.hassan@vistoriasystems.com', 12, 'agil.ali@vistoriasystems.com', 26, '[DEMO] Internal Analytics Portal', 'Enhancement', 'Medium', 'Manual', false, now() - interval '17 days', now() - interval '5 days'),
('[DEMO] Approve KPI dashboard mockups', 'Sign off on the initial mockups before the team starts building.', 'In Progress', 1, 'test@gmail.com', 1, 'test@gmail.com', 26, '[DEMO] Internal Analytics Portal', 'Enhancement', 'Low', 'Manual', false, now() - interval '4 days', now() - interval '1 days');

-- ===== Extra coverage: Vignesh (PM), Divyashree (QA), and Abdirahman
-- (Executive) only appeared as creator/reviewer above, never as the
-- assignee on their own row - added here so each of them also has a
-- populated "self view" on the Performance Dashboard. =====

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", "moduleId", "moduleName", category, priority, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Coordinate go-live checklist with store ops', 'Pull together the rollout checklist for the POS revamp launch.', 'In Progress', 1, 'test@gmail.com', 4, 'vignesh.selvaraj@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', NULL, NULL, 'Enhancement', 'Medium', 'Manual', false, now() - interval '9 days', now() - interval '2 days'),
('[DEMO] Sign off on Q3 banking app release notes', 'Review and approve the release notes before the next app store submission.', 'Backlog', 1, 'test@gmail.com', 4, 'vignesh.selvaraj@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', NULL, NULL, 'Enhancement', 'Low', 'Manual', false, now() - interval '3 days', now() - interval '3 days'),
('[DEMO] Set up QA test environment for offline checkout', 'Need a staging environment that can simulate dropped connectivity for the offline-mode work.', 'In Progress', 4, 'vignesh.selvaraj@vistoriasystems.com', 8, 'divyashree.sampathkumar@vistoriasystems.com', 24, '[DEMO] Retail POS Revamp', 3, 'Checkout Flow', 'Enhancement', 'Medium', 'Manual', false, now() - interval '14 days', now() - interval '5 days'),
('[DEMO] Write QA regression suite for transaction history', 'Cover the pagination fix and scheduled transfers with a repeatable regression suite.', 'Backlog', 4, 'vignesh.selvaraj@vistoriasystems.com', 8, 'divyashree.sampathkumar@vistoriasystems.com', 25, '[DEMO] Mobile Banking App', 7, 'Transactions', 'Enhancement', 'Medium', 'Manual', false, now() - interval '6 days', now() - interval '6 days');

-- Leadership Request: mirrors what IssuesService.create() auto-applies
-- for an Executive/Program Manager creator (source + forced High
-- priority) - included as its own statement since it needs the extra
-- "source" column the rows above don't use.
INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", "projectId", "projectName", category, priority, mode, showstopper, source, "createdAt", "updatedAt") VALUES
('[DEMO] Executive review of analytics portal business case', 'Leadership sign-off needed before committing further engineering time to this project.', 'Backlog', 3, 'abdirahman.hassan@vistoriasystems.com', 3, 'abdirahman.hassan@vistoriasystems.com', 26, '[DEMO] Internal Analytics Portal', 'New Feature', 'High', 'Manual', false, 'Leadership Request', now() - interval '10 days', now() - interval '10 days');

-- ===== [DEMO] Client-submitted tickets (no project - filed via the Client role) =====

INSERT INTO issues (title, description, status, "createdByUserId", "createdByEmail", "assigneeUserId", "assigneeEmail", source, mode, showstopper, "createdAt", "updatedAt") VALUES
('[DEMO] Login page hard to read on mobile', 'The text on the login screen is very small on my phone and hard to read.', 'Backlog', 31, 'demo.client@demo.tracker.local', NULL, NULL, 'Client Feedback', 'Manual', false, now() - interval '3 days', now() - interval '3 days'),
('[DEMO] Please add dark mode option', 'Would love a dark mode for the app, especially for use at night.', 'In Progress', 31, 'demo.client@demo.tracker.local', 4, 'vignesh.selvaraj@vistoriasystems.com', 'Client Feedback', 'Manual', false, now() - interval '6 days', now() - interval '2 days');

COMMIT;
