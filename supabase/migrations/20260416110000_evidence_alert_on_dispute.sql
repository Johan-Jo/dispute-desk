-- Move the evidence-alert dedup flag to the dispute level so it survives
-- pack rebuilds (each rebuild creates a new evidence_packs row).
ALTER TABLE disputes
  ADD COLUMN IF NOT EXISTS evidence_alert_sent_at timestamptz;

COMMENT ON COLUMN disputes.evidence_alert_sent_at
  IS 'Timestamp when the manual-evidence-needed email was first sent; NULL = not yet sent. Prevents duplicate alerts across pack rebuilds.';
