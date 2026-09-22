-- Which fact categories drive the "section rests entirely on suppressed facts"
-- finding? If it is one category, the finding is really about that category.
with pk as (
  select dp.id, dp.facts_json, dp.narrative_json
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
),
sec as (
  select pk.id, s.key as section,
         array(select jsonb_array_elements_text(s.value->'usedFactIds')) as used
  from pk, jsonb_each(pk.narrative_json) s
  where jsonb_typeof(s.value)='object' and s.value ? 'text'
    and length(coalesce(s.value->>'text','')) > 0
),
scored as (
  select sec.id, sec.section, sec.used,
    (select count(*) from unnest(sec.used) u
       join lateral jsonb_array_elements(
         case when jsonb_typeof(pk.facts_json)='array' then pk.facts_json else '[]'::jsonb end) f
         on f->>'id' = u
      where f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
        and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing
  from sec join pk on pk.id = sec.id
)
select f->>'category' as cited_category, count(*) as citations,
       count(distinct scored.id) as packages
from scored
join pk on pk.id = scored.id,
     unnest(scored.used) u
join lateral jsonb_array_elements(
       case when jsonb_typeof(pk.facts_json)='array' then pk.facts_json else '[]'::jsonb end) f
     on f->>'id' = u
where scored.issuer_facing = 0 and cardinality(scored.used) > 0
group by 1 order by citations desc;
