-- In-app notification centre (Stage 5 of the UI redesign, 2026-10-06).
-- One row per notification per recipient; rows only ever belong to one
-- user and are only ever read back by that user (NotificationsController
-- filters on the JWT's own user id). Pruned after 90 days by
-- UserNotificationsService's nightly cron.
BEGIN;
CREATE TABLE "user_notifications" (
  "id" SERIAL NOT NULL PRIMARY KEY,
  "tenantId" integer NOT NULL,
  "userId" integer NOT NULL,
  "type" character varying(64) NOT NULL,
  "title" character varying(300) NOT NULL,
  "body" text,
  "link" character varying(300),
  "actorUserId" integer,
  "actorName" character varying,
  "readAt" TIMESTAMP,
  "createdAt" TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE "user_notifications"
  ADD CONSTRAINT "FK_user_notifications_tenant" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id");
ALTER TABLE "user_notifications"
  ADD CONSTRAINT "FK_user_notifications_user" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE;

-- The bell's two queries: newest-first list, and unread count.
CREATE INDEX "IDX_user_notifications_user_created" ON "user_notifications" ("userId", "createdAt" DESC);
CREATE INDEX "IDX_user_notifications_user_unread" ON "user_notifications" ("userId") WHERE "readAt" IS NULL;
COMMIT;
