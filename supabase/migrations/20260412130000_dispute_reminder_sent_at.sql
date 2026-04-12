-- Track whether the 48h-before-due reminder email has been sent for a
-- dispute, so the cron doesn't spam the merchant on every run.
ALTER TABLE disputes ADD COLUMN IF NOT EXISTS reminder_sent_at timestamptz;
