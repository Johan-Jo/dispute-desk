-- Does a POOLED (all-shops) rate describe any individual shop?
-- If shop rates diverge wildly from pooled, a pooled number is misleading.
with per as (
  select s.shop_domain, d.reason,
         count(*) as n,
         100.0*count(*) filter (where d.normalized_status='won')/count(*) as pct
  from disputes d join shops s on s.id=d.shop_id
  where d.normalized_status in ('won','lost')
  group by 1,2 having count(*) >= 20
), pooled as (
  select reason, count(*) as n,
         100.0*count(*) filter (where normalized_status='won')/count(*) as pct
  from disputes where normalized_status in ('won','lost') group by 1
)
select p.reason,
       round(pooled.pct,1) as pooled_pct, pooled.n as pooled_n,
       p.shop_domain, round(p.pct,1) as shop_pct, p.n as shop_n,
       round(p.pct - pooled.pct,1) as delta
from per p join pooled on pooled.reason = p.reason
order by p.reason, abs(p.pct - pooled.pct) desc;
