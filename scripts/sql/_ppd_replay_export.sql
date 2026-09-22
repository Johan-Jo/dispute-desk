-- Export the trigger pack's REAL plan dispositions for replay.
select
  e->>'fieldKey'      as field_key,
  e->>'recordId'      as record_id,
  e->>'reason'        as reason
from defence_packages dp, jsonb_array_elements(dp.plan_json->'excluded') e
where dp.id = '1ae01792-8f46-45d6-a3eb-61470ce6bbbe'
union all
select i->>'fieldKey', i->>'recordId', 'INCLUDED'
from defence_packages dp, jsonb_array_elements(dp.plan_json->'included') i
where dp.id = '1ae01792-8f46-45d6-a3eb-61470ce6bbbe'
order by reason, field_key;
