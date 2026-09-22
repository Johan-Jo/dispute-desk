select coalesce(f->'value'->>'locationMatch','(none)') as location_match,
       f->>'strength' as strength, f->>'bankEligible' as bank_eligible,
       d.reason, count(*) as n
from defence_packages dp join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome in ('won','lost') and dp.submitted_at is not null
  and f->>'category'='ip_location'
group by 1,2,3,4 order by n desc;
