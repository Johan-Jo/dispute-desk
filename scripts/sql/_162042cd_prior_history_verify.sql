-- Reproduces loadPriorOrderHistory() in SQL for blume-box dispute
-- 162042cd, to confirm the new logic reaches disputeFreeHistory=false.
with target as (
  select d.shop_id,
         d.order_gid,
         o.customer_shopify_id,
         o.processed_at as disputed_at
  from disputes d
  join shopify_orders o
    on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
  where d.id = '162042cd-e256-443b-8c11-da9ad507f039'
),
priors as (
  select o.shopify_order_id, o.processed_at
  from shopify_orders o, target t
  where o.shop_id = t.shop_id
    and o.customer_shopify_id = t.customer_shopify_id
    and o.shopify_order_id <> t.order_gid
    and o.processed_at < t.disputed_at
)
select
  (select count(*) from priors)                              as prior_orders,
  (select count(*) from priors p
     join disputes d2 on d2.order_gid = p.shopify_order_id
                     and d2.shop_id = (select shop_id from target)) as disputed_prior_orders,
  (select count(*) from priors)
    - (select count(*) from priors p
         join disputes d2 on d2.order_gid = p.shopify_order_id
                         and d2.shop_id = (select shop_id from target)) as prior_undisputed_orders;
