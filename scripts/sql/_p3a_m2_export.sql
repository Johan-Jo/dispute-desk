-- Export everything the real scorer needs, per affected dispute.
with latest_dp as (
  select distinct on (dp.dispute_id) dp.* from defence_packages dp
  where dp.plan_json is not null order by dp.dispute_id, dp.created_at desc
),
latest_ep as (
  select distinct on (ep.dispute_id) ep.* from evidence_packs ep
  order by ep.dispute_id, ep.created_at desc
)
select json_agg(row_to_json(t)) as payload from (
  select
    d.dispute_id,
    di.status,
    di.reason,
    p.pack_json->'evidence_model'      as evidence_model,
    p.pack_json->'case_assessment'      as case_assessment,
    p.pack_json->'case_assessment_gates' as gates,
    p.pack_json->'case_strength'        as stored_strength,
    (select json_agg(e->>'fieldKey')
       from jsonb_array_elements(d.plan_json->'excluded') e
      where e->>'reason' = 'not_argument_relevant') as excluded_fields
  from latest_dp d
  join latest_ep p on p.dispute_id = d.dispute_id
  join disputes di on di.id = d.dispute_id
  where exists (
    select 1 from jsonb_array_elements(d.plan_json->'excluded') e
    where e->>'reason' = 'not_argument_relevant'
      and p.pack_json->'evidence_model'->'fields'->(e->>'fieldKey')->>'relevance'
            in ('optional','recommended')
      and (p.pack_json->'evidence_model'->'fields'->(e->>'fieldKey')->'status'->>'available')::boolean
  )
) t;
