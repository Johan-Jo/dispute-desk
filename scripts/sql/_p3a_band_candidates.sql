-- P3a step 2: of the scored-but-excluded records, which are ALSO
-- available+citable (i.e. actually contributing to the score today)?
-- Those are the band-movement candidates.
with latest_dp as (
  select distinct on (dp.dispute_id) dp.* from defence_packages dp
  where dp.plan_json is not null order by dp.dispute_id, dp.created_at desc
),
latest_ep as (
  select distinct on (ep.dispute_id) ep.* from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
),
excl as (
  select d.dispute_id, e->>'fieldKey' as field_key
  from latest_dp d join jsonb_array_elements(d.plan_json->'excluded') e on true
  where e->>'reason' = 'not_argument_relevant'
)
select
  x.field_key,
  p.pack_json->'evidence_model'->'fields'->x.field_key->>'relevance' as relevance,
  count(*) filter (where (p.pack_json->'evidence_model'->'fields'->x.field_key->'status'->>'available')::boolean) as available,
  count(distinct x.dispute_id) as disputes
from excl x
join latest_ep p on p.dispute_id = x.dispute_id
where p.pack_json->'evidence_model'->'fields'->x.field_key->>'relevance' in ('optional','recommended')
group by 1,2
order by available desc;
