-- Open (not yet adjudicated) disputes by current pack strength: count + disputed value
with latest_pack as (
  select distinct on (dispute_id) dispute_id,
    pack_json->'case_strength'->>'overall' as strength,
    (pack_json->'fatal_loss'->>'triggered') = 'true' as fatal_loss
  from evidence_packs
  where pack_json ? 'case_strength'
  order by dispute_id, created_at desc
)
select lp.strength, lp.fatal_loss, d.currency_code,
  count(*) as n, round(sum(d.amount)::numeric, 0) as disputed_amt
from latest_pack lp
join disputes d on d.id = lp.dispute_id
where d.final_outcome is null
group by 1, 2, 3
order by 1, 2, 3;
