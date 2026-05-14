-- Dry run: count E2E fixture rows that would be deleted.
WITH orphan_disputes AS (
  SELECT id FROM disputes
  WHERE dispute_gid LIKE 'gid://shopify/ShopifyPaymentsDispute/test-%'
),
orphan_packs AS (
  SELECT id FROM evidence_packs
  WHERE dispute_id IN (SELECT id FROM orphan_disputes)
)
SELECT
  (SELECT count(*) FROM orphan_disputes)                                      AS disputes,
  (SELECT count(*) FROM orphan_packs)                                         AS packs,
  (SELECT count(*) FROM jobs WHERE entity_id IN (SELECT id::text FROM orphan_packs)) AS jobs,
  (SELECT count(*) FROM audit_events WHERE dispute_id IN (SELECT id FROM orphan_disputes)) AS ae_by_dispute,
  (SELECT count(*) FROM audit_events WHERE pack_id    IN (SELECT id FROM orphan_packs))    AS ae_by_pack;
