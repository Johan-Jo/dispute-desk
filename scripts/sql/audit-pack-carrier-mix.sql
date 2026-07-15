-- Which carriers appear on DISPUTED orders' evidence packs?
-- Extracts every `"carrier": "<name>"` string from packs.pack_json
-- (written by lib/packs/sources/fulfillmentSource.ts from
-- Fulfillment.trackingInfo.company). Read-only; grounds the roster in
-- docs/plans/carrier-delivery-verification.plan.md.
select m[1] as carrier, count(*) as packs
from (
  select regexp_matches(pack_json::text, '"carrier"\s*:\s*"([^"]+)"', 'g') as m
  from evidence_packs
) t
group by 1
order by 2 desc;
