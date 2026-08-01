select d.order_name, d.customer_display_name,
       d.status as shopify_status, d.normalized_status,
       d.initiated_at::date as initiated,
       d.due_at::date as due,
       d.submitted_at,
       d.created_at as dd_row_created,
       d.last_synced_at,
       (select count(*) from evidence_packs ep where ep.dispute_id=d.id) as packs
from disputes d
join shops s on s.id=d.shop_id
where s.shop_domain ilike '%blume%'
order by d.due_at;
