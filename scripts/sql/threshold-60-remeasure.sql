-- Step 5 of the canonical activation plan: re-measure threshold 60.
--
-- A prior report claimed "blocks 19 of 73, flips 17". Unverified, and measured
-- on a population that has since changed. This recomputes it from the two LEGAL
-- pairings `resolveEffectiveCompleteness` defines:
--
--     legacy    = evidence_packs.completeness_score  vs  shop.auto_save_min_score
--     canonical = pack_json.case_assessment.completeness.score  vs  60
--
-- The illegal pairing (legacy score vs 60) is deliberately not computed — it is
-- the thing the resolver exists to make unrepresentable, not a comparison arm.
--
-- "Flip" counts a case whose PASS/FAIL verdict changes between the pairings,
-- which is the only difference activation can actually produce at this gate.
with pop as (
  select
    d.id as dispute_id,
    split_part(d.dispute_gid, '/', 5) as gid,
    ep.completeness_score as legacy_score,
    (ep.pack_json -> 'case_assessment' -> 'completeness' ->> 'score')::numeric as canon_score,
    ep.rebuild_pending,
    coalesce(s.auto_save_min_score, 60) as merchant_threshold
  from disputes d
  join lateral (
    select x.* from evidence_packs x
    where x.dispute_id = d.id and x.status = 'ready'
    order by x.created_at desc limit 1
  ) ep on true
  join shops sh on sh.id = d.shop_id
  left join shop_settings s on s.shop_id = sh.id
  where d.closed_at is null
    and d.evidence_saved_to_shopify_at is null
    and d.submission_state = 'not_saved'
)
select
  count(*) as cases,
  count(canon_score) as have_canonical_snapshot,
  count(*) filter (where canon_score is null) as no_snapshot_falls_back_to_legacy,
  round(avg(canon_score - legacy_score), 2) as mean_delta,
  min(canon_score - legacy_score) as min_delta,
  max(canon_score - legacy_score) as max_delta,
  count(*) filter (where legacy_score >= merchant_threshold) as legacy_passes,
  count(*) filter (where canon_score >= 60) as canonical_passes,
  count(*) filter (where legacy_score >= merchant_threshold and canon_score < 60)
    as activation_BLOCKS,
  count(*) filter (where legacy_score < merchant_threshold and canon_score >= 60)
    as activation_ADMITS
from pop;
