-- Requeue build_pack for OPEN disputes whose current pack was built
-- under either 2026-08-01 defect:
--   A) false dispute-free claim (a prior order was actually charged back)
--   B) phantom prior history (the "prior" order was placed LATER)
--   C) fatal-loss refund_issued where the credit preceded the dispute
--
-- Safe to re-run: skips disputes that already have a queued/running
-- build_pack. Rebuilds do NOT re-charge a pack credit — consumePack is
-- idempotent per (shop_id, dispute_id, 'finalize').
-- Priority 500 keeps this behind interactive merchant work.
with latest_pack as (
  select distinct on (ep.dispute_id) ep.id, ep.dispute_id, ep.pack_json
  from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
),
open_d as (
  select d.id, d.shop_id, d.order_gid, d.due_at, lp.id as pack_id, lp.pack_json
  from disputes d
  join latest_pack lp on lp.dispute_id = d.id
  where d.closed_at is null
    and d.final_outcome is null
    and coalesce(d.submission_state, '') <> 'submitted_confirmed'
    and coalesce(d.normalized_status, '') <> 'submitted_to_bank'
    and d.due_at > now()
),
scored as (
  select o.id, o.shop_id, o.pack_id, o.due_at,
         (select nullif(sec->'data'->>'totalOrders','')::numeric
            from jsonb_array_elements(o.pack_json::jsonb->'sections') sec
           where sec->'labelToken'->>'key' = 'packs.section.customerAccountDetails'
           limit 1) as total_orders,
         (o.pack_json::jsonb->'fatal_loss'->>'reason') as fatal_reason,
         (select count(*) from shopify_orders p
           where p.shop_id = o.shop_id
             and p.customer_shopify_id = mo.customer_shopify_id
             and p.processed_at < mo.processed_at) as real_priors,
         (select count(*) from shopify_orders p
            join disputes dp on dp.shop_id = o.shop_id and dp.order_gid = p.shopify_order_id
           where p.shop_id = o.shop_id
             and p.customer_shopify_id = mo.customer_shopify_id
             and p.processed_at < mo.processed_at) as disputed_priors
  from open_d o
  left join shopify_orders mo
    on mo.shop_id = o.shop_id and mo.shopify_order_id = o.order_gid
),
affected as (
  select * from scored
  where disputed_priors > 0
     or (coalesce(total_orders, 0) - 1) > real_priors
     or fatal_reason = 'refund_issued'
)
insert into jobs (shop_id, job_type, entity_id, priority, status)
select a.shop_id, 'build_pack', a.pack_id::text, 500, 'queued'
from affected a
where not exists (
  select 1 from jobs j
  where j.entity_id = a.pack_id::text
    and j.job_type = 'build_pack'
    and j.status in ('queued', 'running')
)
returning id, entity_id;
