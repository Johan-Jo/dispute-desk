-- Which OPEN disputes could the score change for at all?
-- Only those whose latest defence package carries a plan AND whose plan
-- excluded a record the scorer can currently see (relevance != not_applicable).
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
),
scored_excl as (
  select x.dispute_id, x.field_key
  from excl x join latest_ep p on p.dispute_id = x.dispute_id
  where p.pack_json->'evidence_model'->'fields'->x.field_key->>'relevance'
          in ('optional','recommended')
    and (p.pack_json->'evidence_model'->'fields'->x.field_key->'status'->>'available')::boolean
)
select
  di.status,
  count(distinct se.dispute_id) as disputes,
  sum(1) as scored_excluded_records
from scored_excl se
join disputes di on di.id = se.dispute_id
group by di.status
order by disputes desc;
