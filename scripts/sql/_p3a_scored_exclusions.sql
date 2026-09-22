-- P3a step 1: ENUMERATE plan-excluded records whose evidence-model
-- relevance is NOT 'not_applicable'. Those are the only ones the scorer
-- can currently see (checklistFromModel skips not_applicable before
-- calculateCaseStrength), so they are the candidates for a real scoring
-- delta. No prediction -- this is the count.
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
  coalesce(p.pack_json->'evidence_model'->'fields'->x.field_key->>'relevance','(no model row)') as relevance,
  count(*) as excluded_records,
  count(distinct x.dispute_id) as disputes
from excl x
left join latest_ep p on p.dispute_id = x.dispute_id
group by 1
order by excluded_records desc;
