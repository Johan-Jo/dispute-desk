-- Does the established denominator (accepted counts as a loss) change the
-- Phase 2 base rates? Compare both conventions per shop+reason.
select s.shop_domain, d.reason,
  count(*) filter (where d.final_outcome='won')      as won,
  count(*) filter (where d.final_outcome='lost')     as lost,
  count(*) filter (where d.final_outcome='accepted') as accepted,
  round(100.0*count(*) filter (where d.final_outcome='won')
        /nullif(count(*) filter (where d.final_outcome in ('won','lost')),0),1) as pct_wl,
  round(100.0*count(*) filter (where d.final_outcome='won')
        /nullif(count(*) filter (where d.final_outcome in ('won','lost','accepted')),0),1) as pct_with_accepted
from disputes d join shops s on s.id=d.shop_id
where d.final_outcome in ('won','lost','accepted')
group by 1,2 having count(*) >= 15 order by accepted desc, 1,2;
