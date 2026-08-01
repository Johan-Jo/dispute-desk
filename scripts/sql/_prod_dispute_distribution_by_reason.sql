-- READ-ONLY. Question 3 for the group-overrides plan.
--
-- Which dispute types actually have volume? The group list in §2 was derived
-- from the engine's own family structure (four bespoke scoring formulas), not
-- from data. This tells us whether that structure matches reality — e.g.
-- whether `duplicate` deserves a row at all, or whether something without a
-- group dominates.
--
-- Also splits by case strength, because the store-wide switch only ever
-- governs the clean-Strong slice: a family with volume but no Strong cases
-- gains nothing from an "auto" override.
--
-- SELECT only. No writes.
select
  d.reason,
  count(*)                                                                    as disputes,
  count(distinct d.shop_id)                                                   as shops,
  count(*) filter (where p.pack_json->'case_strength'->>'overall' = 'strong')      as strong,
  count(*) filter (where p.pack_json->'case_strength'->>'overall' = 'moderate')    as moderate,
  count(*) filter (where p.pack_json->'case_strength'->>'overall' in ('weak','insufficient')) as weak,
  count(*) filter (where p.pack_json->'case_strength'->>'overall' is null)         as unscored,
  round(
    100.0 * count(*) filter (where p.pack_json->'case_strength'->>'overall' = 'strong')
    / nullif(count(*), 0)
  , 1)                                                                        as pct_strong
from public.disputes d
left join lateral (
  select pack_json
    from public.evidence_packs ep
   where ep.dispute_id = d.id
   order by ep.created_at desc
   limit 1
) p on true
group by d.reason
order by disputes desc;
