-- The 67 promoted facts sitting on OPEN disputes are the ones where a strength
-- change could alter automation. What state are those disputes in?
select coalesce(d.normalized_status,'(null)') as status,
       coalesce(d.strength_alert_level,'(none)') as strength_alert,
       count(distinct d.id) as disputes
from defence_packages dp
join disputes d on d.id = dp.dispute_id,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where f->>'category'='ip_location'
  and f->'value'->>'locationMatch' = 'same_country'
  and nullif(f->'value'->>'bankLocationSummary','') is not null
  and d.final_outcome is null
group by 1,2 order by disputes desc;
