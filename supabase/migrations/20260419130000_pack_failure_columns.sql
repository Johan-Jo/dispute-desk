-- Distinguish system failures from evidence gaps on the pack record.
--
-- Until now, a pack with status='ready' and a low completeness score
-- could mean either (a) the merchant hasn't uploaded enough evidence,
-- or (b) the upstream Shopify order fetch failed. The merchant UI
-- couldn't tell the difference and rendered both as "Pack Blocked",
-- which is misleading when the cause is on our side.
--
-- failure_code: short machine-readable identifier for the failure.
--   Currently used: 'order_fetch_failed'. Future codes can be added
--   without schema changes.
-- failure_reason: human-readable internal message (full error text).
--   Kept internal — the UI maps failure_code to merchant-safe copy
--   rather than rendering this field directly.

ALTER TABLE evidence_packs
  ADD COLUMN IF NOT EXISTS failure_code text;

ALTER TABLE evidence_packs
  ADD COLUMN IF NOT EXISTS failure_reason text;

COMMENT ON COLUMN evidence_packs.failure_code IS
  'Machine-readable failure identifier (e.g. order_fetch_failed). Set when status=failed; null otherwise.';
COMMENT ON COLUMN evidence_packs.failure_reason IS
  'Internal full error text. Not safe to render to merchants — UI maps failure_code to safe copy.';
