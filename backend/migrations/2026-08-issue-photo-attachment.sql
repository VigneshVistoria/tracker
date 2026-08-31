-- Bug fix: mobile "Take Photo"/"Choose Existing" buttons captured a photo
-- but the ticket-creation flow never sent it anywhere - there was no
-- column to store it in. Stored as raw base64 text (select:false on the
-- entity keeps it out of list queries; only the single-ticket detail
-- view re-selects it).
ALTER TABLE "issues" ADD COLUMN "photoBase64" text;
