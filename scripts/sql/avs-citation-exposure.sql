-- AVS citation exposure — reproducible evidence for the AVS citation plan.
-- ELIGIBILITY (fact carries a citable verificationSummary) vs EMISSION (an
-- address-verification assertion actually reached narrative_json).
-- NOTE: two distinct emission wordings exist; both are unauthorized standalone
-- address claims. Neither S1 (Visa CE Item 3) nor S4 (MC 4837 AVS) authorizes
-- an address assertion without the compound delivered/sent-to-that-address element.
select
  coalesce(d.network_reason_code,'(null)')             as network_reason_code,
  fx->'value'->>'avsResult'                            as avs_code,
  count(*)                                             as packs,
  count(*) filter (where dp.submitted_at is not null)  as saved_to_shopify,
  -- wording 1: the classic summary phrasing
  count(*) filter (where dp.narrative_json::text ilike '%billing address matched%'
                      or dp.narrative_json::text ilike '%billing street matched%'
                      or dp.narrative_json::text ilike '%billing postal code matched%')
                                                       as emit_matched_phrasing,
  -- wording 2: "address verification ... completed/performed"
  count(*) filter (where dp.narrative_json::text ilike '%address verification%')
                                                       as emit_verification_phrasing,
  -- either wording
  count(*) filter (where dp.narrative_json::text ilike '%billing address matched%'
                      or dp.narrative_json::text ilike '%billing street matched%'
                      or dp.narrative_json::text ilike '%billing postal code matched%'
                      or dp.narrative_json::text ilike '%address verification%')
                                                       as emit_any,
  count(*) filter (where dp.submitted_at is not null
                    and (dp.narrative_json::text ilike '%billing address matched%'
                      or dp.narrative_json::text ilike '%billing street matched%'
                      or dp.narrative_json::text ilike '%billing postal code matched%'
                      or dp.narrative_json::text ilike '%address verification%'))
                                                       as saved_and_emitted,
  -- the ONLY authorized form; zero everywhere is the finding
  count(*) filter (where dp.narrative_json::text ilike '%delivered to%same%address%')
                                                       as compound_claim
from defence_packages dp
join disputes d on d.id = dp.dispute_id,
lateral jsonb_array_elements(dp.facts_json) fx
where fx->'value'->>'fieldKey' = 'avs_cvv_match'
  and fx->'value'->>'verificationSummary' like '%billing%'
group by 1,2 order by packs desc;
