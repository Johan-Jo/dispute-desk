-- Which carriers do merchants actually ship with?
-- Primary source (post carrier-plan PR 1A): shopify_fulfillment_trackings —
-- one row per fulfillment tracking entry, written on every order ingest.
-- Grounds adapter priority in docs/plans/carrier-delivery-verification.plan.md §2.
select
  coalesce(carrier_normalized, company_raw, '(none)') as carrier,
  count(*)                                            as tracking_entries,
  count(distinct shop_id)                             as shops,
  count(*) filter (where shipment_status is not null) as with_terminal_state
from shopify_fulfillment_trackings
group by 1
order by 2 desc;

-- Legacy fallback (pre-1A data, or to cross-check DISPUTED orders only):
-- extracts `"carrier": "<name>"` from evidence_packs.pack_json, written by
-- lib/packs/sources/fulfillmentSource.ts from Fulfillment.trackingInfo.company.
-- select m[1] as carrier, count(*) as packs
-- from (
--   select regexp_matches(pack_json::text, '"carrier"\s*:\s*"([^"]+)"', 'g') as m
--   from evidence_packs
-- ) t
-- group by 1
-- order by 2 desc;
