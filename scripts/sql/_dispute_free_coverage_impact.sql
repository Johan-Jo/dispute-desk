-- Impact of requiring VERIFIED dispute-free history (PR #479 + the
-- coverage-test correction).
--
-- Coverage compares ALL of the customer's ingested orders against
-- Shopify's numberOfOrders. The prior count is strictly-before only.
-- Mixing the two scales (the first cut) reports a phantom gap for every
-- customer who ordered again after the disputed order.
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
  select pa.dispute_id, pa.total_orders, d.reason, d.shop_id, d.order_gid,
         o.customer_shopify_id, o.processed_at as disputed_at
  from pack_acct pa
  join disputes d on d.id = pa.dispute_id
  join shopify_orders o
    on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
  where pa.total_orders >= 2 and o.customer_shopify_id is not null
),
counted as (
  select c.dispute_id,
         c.shop_id,
         c.reason,
         c.total_orders                                              as shopify_total,
         count(p.shopify_order_id)                                   as our_total,
         count(*) filter (where p.processed_at < c.disputed_at)      as our_priors,
         count(dp.id) filter (where p.processed_at < c.disputed_at)  as disputed_priors
  from ctx c
  left join shopify_orders p
    on p.shop_id = c.shop_id
   and p.customer_shopify_id = c.customer_shopify_id
  left join disputes dp
    on dp.shop_id = c.shop_id
   and dp.order_gid = p.shopify_order_id
   and dp.order_gid <> c.order_gid
  group by c.dispute_id, c.shop_id, c.reason, c.total_orders
)
select
  case
    when disputed_priors > 0        then 'false_claim_removed (priors were disputed)'
    when our_total >= shopify_total then 'verified_clean (stays strong)'
    else 'unverifiable (genuine coverage gap)'
  end as outcome,
  reason,
  count(*) as disputes
from counted
group by 1, 2
order by 1, 3 desc;
