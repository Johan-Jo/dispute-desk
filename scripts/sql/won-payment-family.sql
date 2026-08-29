select
  s.shop_domain, d.phase,
  coalesce(ep.pack_json->'payment_context'->>'family','(no pack)') as pay_family,
  count(*) as won,
  count(*) filter (where d.submission_state='submitted_confirmed') as we_submitted
from disputes d
join shops s on s.id=d.shop_id
left join evidence_packs ep on ep.dispute_id=d.id
where d.normalized_status='won'
group by 1,2,3 order by won desc;
