-- Size the Shopify Protect finding over a RECENT window (last 12 months), so the
-- figure reflects their current setup rather than 8 years of imported history.
-- covered = order fraud_protection_level in (PROTECTED, ACTIVE)  [Coverage Gate]
with s as (select id from shops where shop_domain ilike '%blume-box%'),
d12 as (
  select d.*, o.fraud_protection_level as prot
  from disputes d
  join s on d.shop_id = s.id
  left join shopify_orders o
         on o.shop_id = d.shop_id and o.shopify_order_id = d.order_gid
  where d.currency_code = 'USD'
    and d.initiated_at >= now() - interval '365 days'
)
select
  case when upper(coalesce(prot,'')) in ('PROTECTED','ACTIVE') then 'covered by Protect'
       else 'NOT covered' end as coverage,
  case when upper(coalesce(reason,'')) in ('FRAUDULENT','UNRECOGNIZED') then 'fraud' else 'non-fraud' end as kind,
  count(*)::text as disputes,
  round(sum(amount)::numeric,2)::text as amount_usd
from d12
group by 1,2
order by 1,2;
