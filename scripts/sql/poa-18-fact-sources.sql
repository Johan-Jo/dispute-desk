select f->>'source' as source, f->>'category' as category,
       count(*) as facts,
       count(*) filter (where f->>'sourceRef' is not null) as with_source_ref
from defence_packages dp
join disputes d on d.id=dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where d.final_outcome in ('won','lost') and dp.submitted_at is not null
group by 1,2 order by facts desc limit 20;
