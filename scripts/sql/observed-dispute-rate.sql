-- Observed dispute rate across real DisputeDesk merchants (prod).
-- Grounds the cold-outreach economics model in our own data rather than an
-- industry-average guess. Uses Shopify-side dates on both sides:
--   orders   -> created_at_shopify   (not our ingest time)
--   disputes -> initiated_at         (not our ingest time)
-- NOTE: disputes has no type column, so inquiries and chargebacks are pooled
-- (see the known inquiry-labelling gap). That makes this an ALL-disputes rate,
-- which is the right denominator for DisputeDesk's pitch since it handles both.
with win as (select (now() - interval '180 days')::timestamptz as t0),
per_shop as (
  select
    s.shop_domain,
    (select count(*) from shopify_orders o, win
       where o.shop_id = s.id and o.created_at_shopify >= win.t0) as orders_180d,
    (select count(*) from disputes d, win
       where d.shop_id = s.id and d.initiated_at >= win.t0) as disputes_180d
  from shops s
)
select
  shop_domain,
  orders_180d,
  disputes_180d,
  round(100.0 * disputes_180d / nullif(orders_180d,0), 3) as dispute_pct
from per_shop
where orders_180d >= 200
order by orders_180d desc;
