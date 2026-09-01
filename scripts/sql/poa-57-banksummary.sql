select dp.prompt_version,
       f->'value'->>'locationMatch' as location_match,
       count(*) as facts,
       count(*) filter (where f->'value' ? 'bankLocationSummary')          as has_summary_key,
       count(*) filter (where nullif(f->'value'->>'bankLocationSummary','') is not null) as summary_populated,
       min(dp.generated_at)::date as first_built,
       max(dp.generated_at)::date as last_built
from defence_packages dp,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where f->>'category'='ip_location'
group by 1,2 order by last_built desc, facts desc limit 12;
