-- Post-recovery verification for cay-collective. Read-only. Run against
-- prod (confirm ref per §0):
--   npx supabase db query --linked --file scripts/sql/verify-cay-collective-recovery.sql
--
-- Pass criteria (Plan A §6):
--   A. historical_import_status = 'complete', completed_at set.
--   B. Monthly order histogram has NO dead band 2025-10 → 2026-05.
--   C. All dispute order_gids resolve to a shopify_orders row (missing = 0).
--   D. No newly-imported rows left with a NULL payment_method that should
--      have one (card/local methods only — manual/gift_card/cash legit-null).

with shop as (
  select id, shop_domain, historical_import_status,
         historical_import_orders_processed, historical_import_orders_total,
         historical_import_completed_at
  from shops
  where shop_domain ilike '%cay-collective%'
  limit 1
)

-- A. Import status
select 'A_import_status' as check, s.shop_domain,
       s.historical_import_status,
       s.historical_import_orders_processed,
       s.historical_import_orders_total,
       s.historical_import_completed_at
from shop s;

-- B. Monthly histogram (watch 2025-10 … 2026-05 for zero-count gaps)
select 'B_histogram' as check,
       to_char(date_trunc('month', o.processed_at), 'YYYY-MM') as month,
       count(*) as orders
from shopify_orders o
join shop s on s.id = o.shop_id
where o.processed_at is not null
group by 1, 2
order by 2;

-- C. Dispute orders that still do NOT resolve to a shopify_orders row.
--    Expect zero rows. Also reports the resolved / total tally.
select 'C_missing_dispute_orders' as check, d.id as dispute_id, d.order_gid
from disputes d
join shop s on s.id = d.shop_id
where d.order_gid is not null
  and not exists (
    select 1 from shopify_orders o
    where o.shop_id = d.shop_id
      and o.shopify_order_id = d.order_gid
  )
order by d.order_gid;

select 'C_tally' as check,
       count(*) filter (where d.order_gid is not null) as dispute_orders_total,
       count(*) filter (
         where d.order_gid is not null and exists (
           select 1 from shopify_orders o
           where o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid)
       ) as resolved
from disputes d
join shop s on s.id = d.shop_id;

-- D. payment_method coverage on the shop's imported orders.
select 'D_payment_method_coverage' as check,
       count(*) as total_orders,
       count(*) filter (where payment_method is not null) as with_method,
       count(*) filter (where payment_method is null) as null_method
from shopify_orders o
join shop s on s.id = o.shop_id;
