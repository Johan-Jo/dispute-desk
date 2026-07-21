-- Inspect the newly built pack for the "not shipped / delivered" contradiction.
-- Dispute: 5e63afa7-af68-4eba-a92f-5ba11605aab7 (blume-box, prod)
select
  d.id,
  d.reason,
  d.dispute_type,
  d.amount,
  d.order_name,
  d.order_gid,
  d.status,
  d.normalized_status,
  d.network_reason_code
from disputes d
where d.id = '5e63afa7-af68-4eba-a92f-5ba11605aab7';
