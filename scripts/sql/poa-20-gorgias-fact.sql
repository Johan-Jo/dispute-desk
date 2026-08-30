select dp.dispute_id, f->>'id' as fact_id, jsonb_pretty(f) as fact
from defence_packages dp
join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome in ('won','lost') and dp.submitted_at is not null
  and f->>'source' = 'gorgias'
limit 1;
