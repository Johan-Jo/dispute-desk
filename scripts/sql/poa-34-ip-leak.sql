with pk as (
  select dp.id, d.order_name, d.reason, dp.prompt_version,
         dp.narrative_json,
         (select bool_or(f->>'bankEligible'='true')
            from jsonb_array_elements(
              case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
           where f->>'category'='ip_location')                    as ip_bank_eligible,
         (select count(*) from jsonb_array_elements(
              case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
           where f->>'category'='ip_location')                    as ip_facts
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome in ('won','lost') and dp.submitted_at is not null
),
txt as (
  select pk.*, string_agg(s.value->>'text', ' ') as all_text
  from pk, jsonb_each(pk.narrative_json) s
  where jsonb_typeof(s.value)='object' and s.value ? 'text'
  group by pk.id, pk.order_name, pk.reason, pk.prompt_version, pk.narrative_json,
           pk.ip_bank_eligible, pk.ip_facts
)
select
  count(*)                                                          as packages,
  count(*) filter (where ip_facts > 0)                              as holds_ip_fact,
  count(*) filter (where ip_bank_eligible)                          as ip_bank_eligible,
  count(*) filter (where all_text ~* '\m(IP address|IP geolocat|geolocat)')            as text_mentions_ip,
  count(*) filter (where all_text ~* '\m(IP address|IP geolocat|geolocat)'
                     and coalesce(ip_bank_eligible,false) = false)  as LEAK_ip_text_without_eligibility,
  count(*) filter (where all_text ~* '(VPN|proxy|datacenter)'
                     and coalesce(ip_bank_eligible,false) = false)  as leak_vpn_language
from txt;
