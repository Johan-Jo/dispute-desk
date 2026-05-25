-- Read the in-DB submission_state column the saveToShopifyJob guards on.
-- "submitted_confirmed" means the merchant has clicked Submit in Shopify
-- Admin → evidence is locked, no further updates accepted.
-- Anything else means the response window is still open and we can
-- legitimately PATCH the evidence on Shopify's side.
select
  id,
  shopify_dispute_id,
  status,
  submission_state,
  submitted_at,
  evidence_due_by,
  shop_id
from disputes
where id = 'd466544f-d8ed-4e29-b04d-34834ab3c6b5';
