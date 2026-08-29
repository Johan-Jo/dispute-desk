-- Is a shop+reason rate STABLE over time, or does it drift enough that a
-- single number would mislead? Half-by-half split on the largest cells.
with c as (
  select s.shop_domain, d.reason, d.normalized_status, d.initiated_at,
         ntile(2) over (partition by s.shop_domain, d.reason order by d.initiated_at) as half
  from disputes d join shops s on s.id=d.shop_id
  where d.normalized_status in ('won','lost')
)
select shop_domain, reason,
  count(*) filter (where half=1) as n_older,
  round(100.0*count(*) filter (where half=1 and normalized_status='won')
        /nullif(count(*) filter (where half=1),0),1) as pct_older,
  count(*) filter (where half=2) as n_newer,
  round(100.0*count(*) filter (where half=2 and normalized_status='won')
        /nullif(count(*) filter (where half=2),0),1) as pct_newer
from c group by 1,2 having count(*) >= 20 order by count(*) desc;
