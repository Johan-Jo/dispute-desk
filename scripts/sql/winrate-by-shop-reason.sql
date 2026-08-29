-- Phase 2 base rates: win rate per shop per reason, across the FULL corpus
-- (historical imports + cases we defended). Aggregate only — never a
-- per-case claim.
select
  s.shop_domain,
  d.reason,
  count(*) filter (where d.normalized_status='won')  as won,
  count(*) filter (where d.normalized_status='lost') as lost,
  count(*) as decided,
  round(100.0*count(*) filter (where d.normalized_status='won')/count(*),1) as win_pct
from disputes d
join shops s on s.id = d.shop_id
where d.normalized_status in ('won','lost')
group by 1,2
having count(*) >= 5
order by s.shop_domain, decided desc;
