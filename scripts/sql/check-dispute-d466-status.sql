-- Shopify dispute status drives whether disputeEvidenceUpdate can still
-- change the submitted evidence. Once Shopify closes the case window
-- (status moves out of NEEDS_RESPONSE / past evidence_due_by), the
-- mutation will fail and an "auto-correct" re-submission will be a noop
-- in Shopify while corrupting our own local audit trail.
select
  id,
  shopify_dispute_id,
  status,
  reason,
  initiated_at,
  evidence_due_by,
  finalized_at,
  amount_amount,
  amount_currency_code,
  shop_id
from disputes
where id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5';
