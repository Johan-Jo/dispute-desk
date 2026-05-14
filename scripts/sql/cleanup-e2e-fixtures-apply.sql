-- Cleanup orphan E2E fixture rows + their audit_events.
-- audit_events is append-only via BEFORE DELETE/UPDATE triggers; we
-- temporarily disable them inside a single transaction.

BEGIN;

-- Snapshot the orphan IDs into temp tables so every subsequent step
-- references the same set even after deletes.
CREATE TEMP TABLE _orphan_disputes ON COMMIT DROP AS
  SELECT id FROM disputes
  WHERE dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/test-%';

CREATE TEMP TABLE _orphan_packs ON COMMIT DROP AS
  SELECT id FROM evidence_packs
  WHERE dispute_id IN (SELECT id FROM _orphan_disputes);

ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_delete;
ALTER TABLE audit_events DISABLE TRIGGER trg_audit_no_update;

DELETE FROM audit_events
 WHERE dispute_id IN (SELECT id FROM _orphan_disputes)
    OR pack_id    IN (SELECT id FROM _orphan_packs);

ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_delete;
ALTER TABLE audit_events ENABLE TRIGGER trg_audit_no_update;

DELETE FROM jobs
 WHERE entity_id IN (SELECT id::text FROM _orphan_packs);

DELETE FROM evidence_packs
 WHERE id IN (SELECT id FROM _orphan_packs);

DELETE FROM disputes
 WHERE id IN (SELECT id FROM _orphan_disputes);

-- Sanity: triggers re-enabled?
SELECT tgname, tgenabled
  FROM pg_trigger
 WHERE tgrelid = 'audit_events'::regclass
   AND tgname IN ('trg_audit_no_delete','trg_audit_no_update');

COMMIT;

-- Post-commit verification.
SELECT count(*) AS remaining_fixture_disputes
  FROM disputes
 WHERE dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/test-%';
