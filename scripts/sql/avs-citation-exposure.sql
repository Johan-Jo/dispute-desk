-- AVS citation exposure — reproducible evidence for the AVS citation work.
--
-- CORRECTED 2026-08-26. The prior version scoped rows with
--   fx->'value'->>'verificationSummary' like '%billing%'
-- which EXCLUDED the two populations that matter most:
--   * #347617, whose fact had verificationSummary = NULL (CVV-only) yet whose
--     PDF asserted address verification in three places;
--   * the entire second-wording population ("address verification ...
--     completed"), which never carries a billing-phrased summary.
-- Scope is now every payment_authentication fact, and emission is measured by
-- claim CLASS across both observed wordings.
--
-- Run: npm run db:query:prod -- --file scripts/sql/avs-citation-exposure.sql --output table
with pkg as (
  select
    dp.id,
    d.order_name,
    coalesce(d.network_reason_code, '(null)')            as network_reason_code,
    d.status                                             as dispute_status,
    d.due_at,
    dp.submitted_at,
    max(fx->'value'->>'avsResult')      filter (where fx->>'category' = 'payment_authentication') as avs_code,
    bool_or((fx->'value'->>'addressVerified')::boolean)  filter (where fx->>'category' = 'payment_authentication') as address_verified_flag,
    max(fx->'value'->>'verificationSummary') filter (where fx->>'category' = 'payment_authentication') as verification_summary,
    -- wording 1: the summary phrasing
    (dp.narrative_json::text ilike '%billing address matched%'
      or dp.narrative_json::text ilike '%billing street matched%'
      or dp.narrative_json::text ilike '%billing postal code matched%')  as emit_w1,
    -- wording 2: "address verification ... completed/performed"
    (dp.narrative_json::text ilike '%address verification%')             as emit_w2,
    -- Packages that ASSERTED the compound wording — an address claim tied to
    -- delivery (Visa CE Item 3) or dispatch (MC 4837) to that same address.
    --
    -- NAMED `asserted_compound_claim` DELIBERATELY. It counts what the prose
    -- SAYS, never what the network rule was SATISFIED by. On this corpus all
    -- 138 hits are the RETIRED `deliveredToVerifiedAddress` claim and every
    -- one predates PR-C1 (newest 2026-08-06, the day before the fix). That
    -- claim was unsound precisely because it never read an AVS code — so a
    -- non-zero count here is evidence of a defect, not of compliance.
    -- Measured over CONCATENATED SECTION PROSE, not narrative_json::text —
    -- the raw JSON interleaves field names and escapes, so a cross-field
    -- regex matched 109 packages on 4837/N where no address is asserted at
    -- all. `[^.]` also cannot bound a sentence across those escapes.
    exists (
      select 1
      from jsonb_each(dp.narrative_json) sect
      where jsonb_typeof(sect.value) = 'object'
        and sect.value ? 'text'
        and (sect.value->>'text') ~*
            '(deliver(ed|y)?|shipp?(ed)?|sent|dispatch(ed)?)[^.!?]{0,120}\y(same|confirmed|verified|AVS)\y[^.!?]{0,40}address'
    )                                                                         as asserted_compound_claim
  from defence_packages dp
  join disputes d on d.id = dp.dispute_id
  left join lateral jsonb_array_elements(dp.facts_json) fx on true
  group by dp.id, d.order_name, d.network_reason_code, d.status, d.due_at,
           dp.submitted_at, dp.narrative_json
)
select
  network_reason_code,
  coalesce(avs_code, case when address_verified_flag then '(withheld)' else '(none)' end) as avs_code,
  count(*)                                                       as packages,
  count(*) filter (where submitted_at is not null)               as saved_to_shopify,
  count(*) filter (where emit_w1)                                as emit_summary_phrasing,
  count(*) filter (where emit_w2)                                as emit_verification_phrasing,
  count(*) filter (where emit_w1 or emit_w2)                     as emit_any,
  count(*) filter (where (emit_w1 or emit_w2) and submitted_at is not null) as saved_and_emitted,
  count(*) filter (where (emit_w1 or emit_w2) and dispute_status = 'needs_response' and due_at > now()) as emitted_still_open,
  count(*) filter (where asserted_compound_claim)                as asserted_compound_claim
from pkg
where emit_w1 or emit_w2 or avs_code is not null or address_verified_flag
group by 1, 2
order by packages desc;
