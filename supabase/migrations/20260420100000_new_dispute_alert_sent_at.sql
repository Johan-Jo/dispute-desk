-- Track when the "new dispute detected" email was sent per dispute so a
-- transient SELECT error in sync (which makes an existing dispute look
-- brand-new) cannot fire the alert a second time.
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS new_dispute_alert_sent_at timestamptz;

COMMENT ON COLUMN disputes.new_dispute_alert_sent_at
  IS 'Timestamp when the new-dispute email was sent for this row; NULL = not yet sent. Prevents duplicate alerts when the sync existence-check returns null on a transient error.';

-- Backfill: any dispute older than 1 hour is assumed already notified (or
-- intentionally not notified) — we only want to guard future re-fires.
UPDATE disputes
SET new_dispute_alert_sent_at = created_at
WHERE new_dispute_alert_sent_at IS NULL
  AND created_at < now() - interval '1 hour';
