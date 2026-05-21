-- Backfill shops.currency_code for installs predating the column.
--
-- Best-effort: we derive the shop's primary currency from the most-
-- frequent currency_code across its disputes. Imperfect (a shop with
-- 95% EUR chargebacks and a USD presentment currency will be backfilled
-- to EUR), but it matches the heuristic the dashboard used before
-- this migration, so the merchant sees no behavior change for
-- pre-existing shops. The next shop/update webhook (or re-install)
-- will pull the truth from Shopify and overwrite.
--
-- Only updates rows where currency_code is currently null.

with most_frequent as (
  select
    d.shop_id,
    d.currency_code,
    row_number() over (
      partition by d.shop_id
      order by count(*) desc, d.currency_code asc
    ) as rn
  from public.disputes d
  where d.currency_code is not null
  group by d.shop_id, d.currency_code
)
update public.shops s
set currency_code = mf.currency_code
from most_frequent mf
where mf.shop_id = s.id
  and mf.rn = 1
  and s.currency_code is null;

-- Show the result so we can sanity-check.
select s.shop_domain, s.currency_code
from public.shops s
order by s.shop_domain;
