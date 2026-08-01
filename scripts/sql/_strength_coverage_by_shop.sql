with adjudicated as (
  select d.id, d.shop_id, d.final_outcome, d.initiated_at
  from disputes d where d.final_outcome in ('won','lost')
)
select
  s.shop_domain,
  count(*) as adjudicated,
  count(ep.dispute_id) as has_pack,
  count(*) filter (where ep.pack_json ? 'case_strength') as has_strength,
  count(*) filter (where a.final_outcome = 'won') as won,
  min(a.initiated_at)::date as oldest,
  max(a.initiated_at)::date as newest
from adjudicated a
join shops s on s.id = a.shop_id
left join lateral (
  select dispute_id, pack_json from evidence_packs
  where dispute_id = a.id order by created_at desc limit 1
) ep on true
group by 1 order by 2 desc;
