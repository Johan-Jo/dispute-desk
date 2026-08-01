-- Why do disputes show fewer ingested "priors" than Shopify's
-- numberOfOrders-1? Hypothesis: Shopify counts LATER orders too, so the
-- coverage test is comparing priors against all-other-orders.
with pack_acct as (
  select distinct on (ep.dispute_id)
         ep.dispute_id,
         nullif(s->'data'->>'totalOrders', '')::numeric as total_orders
  from evidence_packs ep,
       lateral jsonb_array_elements(ep.pack_json::jsonb->'sections') s
  where s->'labelToken'->>'key' = 'packs.section.customerAccountDetails'
    and ep.created_at > now() - interval '90 days'
  order by ep.dispute_id, ep.created_at desc
),
ctx as (
  select pa.dispute_id, pa.total_orders, d.shop_id, d.order_gid,
         o.customer_shopify_id, o.processed_at as disputed_at
  from pack_acct pa
  join disputes d on d.id = pa.dispute_id
  join shopify_orders o
    on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
  where pa.total_orders >= 2 and o.customer_shopify_id is not null
)
select
  (c.total_orders - 1)                                          as shopify_priors,
  count(*) filter (where p.processed_at < c.disputed_at)         as our_priors,
  count(*) filter (where p.processed_at > c.disputed_at)         as our_later_orders,
  count(*)                                                       as our_total_for_customer,
  c.total_orders                                                 as shopify_total
from ctx c
left join shopify_orders p
  on p.shop_id = c.shop_id
 and p.customer_shopify_id = c.customer_shopify_id
group by c.dispute_id, c.total_orders
order by 1 desc, 2;
