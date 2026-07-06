-- Research: what fulfillment/delivery state do we actually have captured?
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select
  count(*)                                                        as total,
  count(*) filter (where fulfilled_at is not null)               as has_fulfilled_at,
  count(*) filter (where fulfillment_status is not null)         as has_fulfillment_status,
  count(*) filter (where delivery_status is not null)            as has_delivery_status,
  count(*) filter (where delivered_at_tracking is not null)      as has_delivered_at,
  count(*) filter (where signed_by_name is not null)             as has_signed,
  count(*) filter (where tracking_source is not null)            as has_tracking_source,
  min(created_at_shopify)                                        as earliest_order,
  max(created_at_shopify)                                        as latest_order,
  max(processed_at)                                              as latest_processed
from shopify_orders, s where shop_id = s.sid;
