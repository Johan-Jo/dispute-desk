select f->>'strength' as strength,
       f->>'bankEligible' as bank_eligible,
       count(*) as facts,
       count(distinct f->>'category') as categories,
       string_agg(distinct f->>'category', ', ') as example_categories
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome in ('won','lost') and dp.submitted_at is not null
group by 1,2 order by 1,2;
