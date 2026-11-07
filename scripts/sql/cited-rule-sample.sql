-- READ-ONLY. Measurement sample for the "one cited rule" change
-- (lib/defence/citedFacts.ts): the stored facts_json and narrative_json of
-- recent defence packages, up to 50 newest per shop, so several shops and
-- reason families are represented. Run the legacy and the cited Evidence Basis
-- rule over it offline (the cited rule needs the narrative: an item is cited iff
-- the letter relies on it):
--   npx tsx scripts/evidence-model/citedRuleDelta.analysis.ts <sample.json>
-- Run with (the guard prints the linked ref; confirm it is prod):
--   npm run db:query:prod -- --read-only --output json --file scripts/sql/cited-rule-sample.sql > sample.json
select
  dp.id,
  dp.shop_id,
  dp.reason_code_module,
  dp.package_mode,
  dp.prompt_family,
  dp.status,
  dp.generated_at,
  dp.facts_json,
  dp.narrative_json
from (
  select
    d.*,
    row_number() over (partition by d.shop_id order by d.generated_at desc) as rn
  from public.defence_packages d
  where d.facts_json is not null
    and jsonb_typeof(d.facts_json) = 'array'
    and jsonb_array_length(d.facts_json) > 0
    and d.narrative_json is not null
    and d.status in ('draft', 'final', 'submitted', 'superseded', 'stale')
) dp
where dp.rn <= 50
order by dp.generated_at desc
limit 800;
