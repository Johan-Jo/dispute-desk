-- OPEN disputes whose current pack was built under either defect:
--   A) false dispute-free claim (a prior order was charged back)
--   B) phantom prior history (only "prior" order came LATER)
--   C) fatal-loss refund_issued that the credit actually preceded
-- Restricted to disputes that can still change: not closed, not
-- transmission-confirmed, deadline not passed.
with latest_pack as (
  select distinct on (ep.dispute_id) ep.id, ep.dispute_id, ep.pack_json, ep.created_at
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
),
open_d as (
  select d.id, d.shop_id, d.order_gid, d.reason, d.due_at, d.normalized_status,
         d.submission_state, s.shop_domain, lp.id as pack_id, lp.pack_json
  from disputes d
  join shops s on s.id = d.shop_id
  join latest_pack lp on lp.dispute_id = d.id
  where d.closed_at is null
    and d.final_outcome is null
    and coalesce(d.submission_state, '') <> 'submitted_confirmed'
    and coalesce(d.normalized_status, '') <> 'submitted_to_bank'
    and d.due_at > now()
),
acct as (
  select o.*,
         (select nullif(sec->'data'->>'totalOrders','')::numeric
            from jsonb_array_elements(o.pack_json::jsonb->'sections') sec
           where sec->'labelToken'->>'key' = 'packs.section.customerAccountDetails'
           limit 1) as total_orders,
         (o.pack_json::jsonb->'fatal_loss'->>'reason')    as fatal_reason,
         (o.pack_json::jsonb->'fatal_loss'->>'triggered') as fatal_triggered
  from open_d o
)
select a.id            as dispute_id,
       a.shop_domain,
       a.reason,
       a.due_at,
       a.total_orders,
       a.fatal_reason,
       (select count(*) from shopify_orders p
          join disputes dp on dp.shop_id = a.shop_id and dp.order_gid = p.shopify_order_id
         where p.shop_id = a.shop_id
           and p.customer_shopify_id = mo.customer_shopify_id
           and p.processed_at < mo.processed_at)          as disputed_priors,
       (select count(*) from shopify_orders p
         where p.shop_id = a.shop_id
           and p.customer_shopify_id = mo.customer_shopify_id
           and p.processed_at < mo.processed_at)          as real_priors
from acct a
left join shopify_orders mo
  on mo.shop_id = a.shop_id and mo.shopify_order_id = a.order_gid
order by a.due_at;
