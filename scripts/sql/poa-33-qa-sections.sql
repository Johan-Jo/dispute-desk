with pk as (
  select dp.id, dp.dispute_id, dp.facts_json, dp.narrative_json, dp.prompt_version, d.order_name
  from defence_packages dp join disputes d on d.id=dp.dispute_id
  where d.final_outcome='lost' and d.reason='FRAUDULENT' and dp.submitted_at is not null
),
sec as (
  select pk.id, pk.order_name, pk.prompt_version, s.key as section,
         s.value->>'text' as text,
         array(select jsonb_array_elements_text(s.value->'usedFactIds')) as used
  from pk, jsonb_each(pk.narrative_json) s
  where jsonb_typeof(s.value)='object' and s.value ? 'text'
),
scored as (
  select sec.*,
    (select count(*) from unnest(sec.used) u
      join lateral jsonb_array_elements(
        case when jsonb_typeof(pk2.facts_json)='array' then pk2.facts_json else '[]'::jsonb end) f
        on f->>'id' = u
     where f->>'bankEligible'='true' and f->>'includeInBankNarrative'='true'
       and coalesce(f->>'submissionRisk','false')<>'true') as issuer_facing_support
  from sec join pk pk2 on pk2.id = sec.id
)
select order_name, prompt_version, section, cardinality(used) as cited, issuer_facing_support,
       left(text, 240) as text_head
from scored
where issuer_facing_support = 0 and cardinality(used) > 0
  and section in ('paymentAuthenticationArgument','transactionOverviewArgument')
order by section limit 4;
