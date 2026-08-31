with pk as (
  select dp.id, d.order_name, d.reason, d.final_outcome, dp.prompt_version, dp.narrative_json,
         (select f->'value'->>'locationMatch' from jsonb_array_elements(
            case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
          where f->>'category'='ip_location' limit 1) as location_match
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome in ('won','lost') and dp.submitted_at is not null
),
txt as (
  select pk.*, string_agg(s.value->>'text',' ') as all_text
  from pk, jsonb_each(pk.narrative_json) s
  where jsonb_typeof(s.value)='object' and s.value ? 'text'
  group by pk.id, pk.order_name, pk.reason, pk.final_outcome, pk.prompt_version,
           pk.narrative_json, pk.location_match
)
select location_match,
       count(*) as packages,
       count(*) filter (where all_text ~* '\m(IP address|IP geolocat|geolocat)') as mentions_ip_in_bank_text
from txt group by 1 order by 1;
