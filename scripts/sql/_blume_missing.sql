select d.id, d.order_name, d.customer_display_name, d.reason,
       d.status as shopify_status, d.normalized_status,
       d.initiated_at::date as initiated, d.due_at::date as due,
       d.created_at as dd_row_created, d.last_synced_at,
       d.evidence_saved_to_shopify_at
from disputes d
join shops s on s.id=d.shop_id
where s.shop_domain ilike '%blume%'
  and d.due_at >= timestamptz '2026-07-20 16:47:23+00'
  and not exists (select 1 from evidence_packs ep where ep.dispute_id=d.id)
order by d.due_at;
