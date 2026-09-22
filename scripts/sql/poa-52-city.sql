-- Every locationMatch value across ALL packages, not just decided ones,
-- with how each is tiered and whether it reaches the issuer.
select f->'value'->>'locationMatch' as location_match,
       f->>'strength'               as strength,
       (f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing,
       count(*)                     as facts,
       count(distinct dp.dispute_id) as disputes
from defence_packages dp,
     jsonb_array_elements(case when jsonb_typeof(dp.facts_json)='array' then dp.facts_json else '[]'::jsonb end) f
where f->>'category'='ip_location'
group by 1,2,3 order by facts desc;
