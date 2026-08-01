select f.value->>'id' as id, f.value->>'category' as category, f.value->>'strength' as strength,
       f.value->'value'->>'fieldKey' as field_key, f.value->>'bankEligible' as bank_eligible,
       f.value->>'internalOnly' as internal_only
from defence_packages dp, jsonb_array_elements(dp.facts_json::jsonb) f
where dp.id = '7304e09f-862b-4266-b3bf-209b2f4a8446'
order by category;
