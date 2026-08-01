select dp.status, f->>'label' as label, f->>'strength' as strength,
       f->>'bankEligible' as bank_eligible, f->'value'->>'fieldKey' as field
from defence_packages dp, jsonb_array_elements(dp.facts_json::jsonb) f
where dp.dispute_id = '0f53431d-177c-46b7-b199-e7a766f28a88'
order by dp.created_at desc, f->>'strength';
