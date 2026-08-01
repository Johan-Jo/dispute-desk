-- Win rate by pack case strength (weak/moderate/strong), split by submitted vs not.
-- Adjudicated disputes only (final_outcome in won/lost). Latest pack per dispute.
with latest_pack as (
  select distinct on (dispute_id)
    dispute_id,
    pack_json->'case_strength'->>'overall' as strength,
    (pack_json->'fatal_loss') is not null and (pack_json->'fatal_loss'->>'triggered') = 'true' as fatal_loss
  from evidence_packs
  where pack_json ? 'case_strength'
  order by dispute_id, created_at desc
)
select
  coalesce(lp.strength, 'no_pack')  as strength,
  (d.submitted_at is not null or d.evidence_saved_to_shopify_at is not null) as submitted,
  count(*)                                            as n,
  count(*) filter (where d.final_outcome = 'won')     as won,
  count(*) filter (where d.final_outcome = 'lost')    as lost,
  round(100.0 * count(*) filter (where d.final_outcome = 'won') / count(*), 1) as win_pct,
  round(sum(d.outcome_amount_recovered)::numeric, 0)  as recovered,
  round(sum(d.amount)::numeric, 0)                    as disputed_amt
from disputes d
left join latest_pack lp on lp.dispute_id = d.id
where d.final_outcome in ('won','lost')
group by 1, 2
order by 1, 2;
