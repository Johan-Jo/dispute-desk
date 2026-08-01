select
  d.id,
  d.shopify_dispute_id,
  d.status,
  d.review_state,
  d.approved_for_save_at,
  d.submitted_at,
  d.evidence_due_by,
  d.final_outcome,
  dp.id as pack_id,
  dp.status as pack_status,
  dp.saved_to_shopify_at,
  dp.updated_at as pack_updated_at
from disputes d
left join defence_packages dp on dp.dispute_id = d.id
where d.id = '0ab14b8f-a1f1-47fb-8817-1ddaa9bef92b'
order by dp.updated_at desc nulls last;
