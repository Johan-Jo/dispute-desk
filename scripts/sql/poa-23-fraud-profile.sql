with fraud as (
  select dp.id as pkg_id, dp.facts_json
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
),
tot as (select count(*) as n from fraud),
cats as (
  select f->>'category' as category,
         count(distinct fr.pkg_id) as pkgs_with,
         count(distinct fr.pkg_id) filter (where f->>'bankEligible'='true'
              and f->>'includeInBankNarrative'='true'
              and coalesce(f->>'submissionRisk','false')<>'true') as pkgs_issuer_facing
  from fraud fr, jsonb_array_elements(
     case when jsonb_typeof(fr.facts_json)='array' then fr.facts_json else '[]'::jsonb end) f
  group by 1
)
select cats.category, cats.pkgs_with, cats.pkgs_issuer_facing, tot.n as total_pkgs
from cats, tot order by cats.pkgs_issuer_facing desc, cats.pkgs_with desc;
