-- Track when the "manual evidence needed" email was sent per pack
-- to prevent duplicate alerts on pack rebuilds.
ALTER TABLE evidence_packs
  ADD COLUMN IF NOT EXISTS evidence_alert_sent_at timestamptz;

COMMENT ON COLUMN evidence_packs.evidence_alert_sent_at
  IS 'Timestamp when the manual-evidence-needed email was sent for this pack; NULL = not yet sent';
