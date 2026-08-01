-- A) The adjudicated disputes that HAVE a strength label: full detail
with labeled as (
  select distinct on (ep.dispute_id) ep.dispute_id,
    ep.pack_json->'case_strength'->>'overall' as strength
  from evidence_packs ep
  where ep.pack_json ? 'case_strength'
  order by ep.dispute_id, ep.created_at desc
)
select s.shop_domain, d.reason, d.amount, d.currency_code,
  d.final_outcome, d.submission_state, d.submitted_at is not null as has_submitted_at,
  d.outcome_source, l.strength, d.initiated_at::date
from labeled l
join disputes d on d.id = l.dispute_id
join shops s on s.id = d.shop_id
where d.final_outcome in ('won','lost')
order by s.shop_domain, d.initiated_at;
