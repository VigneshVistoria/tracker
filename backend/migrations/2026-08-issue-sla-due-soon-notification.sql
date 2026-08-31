-- Dedupe guard for the SLA "due within an hour" scheduled email - records
-- when that alert last fired for an issue so a recurring cron tick doesn't
-- resend it every time it polls.
ALTER TABLE "issues" ADD COLUMN "slaDueSoonNotifiedAt" timestamp;
