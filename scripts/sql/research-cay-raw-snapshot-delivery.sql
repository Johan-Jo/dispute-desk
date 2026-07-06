-- Do the raw Shopify snapshots captured at pack-build time contain any
-- native delivery signal (fulfillments[].deliveredAt / events)? The pack
-- builder's order query DOES fetch deliveredAt, so if it's null here the
-- data genuinely was not in Shopify.
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select
  count(*)                                                              as disputes_with_snapshot,
  count(*) filter (where raw_snapshot::text ilike '%deliveredAt%')      as mentions_deliveredAt_key,
  count(*) filter (where raw_snapshot::text ilike '%"deliveredAt":"20%')as deliveredAt_has_date,
  count(*) filter (where raw_snapshot::text ilike '%DELIVERED%')        as mentions_DELIVERED,
  count(*) filter (where raw_snapshot::text ilike '%signed%')           as mentions_signed,
  count(*) filter (where raw_snapshot::text ilike '%trackingInfo%')     as mentions_trackingInfo,
  count(*) filter (where raw_snapshot::text ilike '%PostNord%')         as mentions_postnord
from disputes, s
where shop_id = s.sid and raw_snapshot is not null;
