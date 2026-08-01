select d.order_name, d.customer_display_name, d.status as shopify_status, d.normalized_status,
       d.due_at::date as due, d.submitted_at, d.evidence_saved_to_shopify_at,
       (select count(*) from evidence_packs ep where ep.dispute_id=d.id) as packs,
       (select string_agg(distinct ep.status, ',') from evidence_packs ep where ep.dispute_id=d.id) as pack_statuses
from disputes d
join shops s on s.id=d.shop_id
where s.shop_domain ilike '%blume%'
  and d.order_name in ('#345744','#345993','#345617','#345812','#340687','#344707','#344429')
order by d.order_name;
