-- Wins by shop and phase, and whether we filed anything at all.
select
  s.shop_domain,
  d.phase,
  count(*) as won,
  count(*) filter (where d.submission_state = 'submitted_confirmed') as submitted_confirmed,
  count(*) filter (where p.id is not null) as has_defence_pkg,
  count(*) filter (where jsonb_typeof(p.facts_json)='array' and jsonb_array_length(p.facts_json)>0) as has_facts
from disputes d
join shops s on s.id = d.shop_id
left join defence_packages p on p.dispute_id = d.id and p.status = 'submitted'
where d.normalized_status = 'won'
group by s.shop_domain, d.phase
order by won desc;
