select distinct f->'value'->>'locationMatch' as match,
       f->'value'->>'bankLocationSummary'    as approved_sentence,
       count(*) over (partition by f->'value'->>'bankLocationSummary') as uses
from defence_packages dp,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where f->>'category'='ip_location'
  and nullif(f->'value'->>'bankLocationSummary','') is not null
limit 5;
