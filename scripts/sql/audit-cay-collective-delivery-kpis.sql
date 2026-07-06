with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select
  count(*) as total_orders,
  count(*) filter (where processed_at >= (now() - interval '30 days')) as processed_last30,
  count(*) filter (where fulfilled_at is not null) as any_fulfilled,
  count(*) filter (where fulfilled_at is not null and processed_at >= (now() - interval '30 days')) as fulfilled_last30,
  count(*) filter (where delivery_status is not null) as has_delivery_status,
  count(*) filter (where delivery_status = 'Delivered') as delivered_status,
  count(*) filter (where delivered_at_tracking is not null) as has_delivered_at_tracking,
  count(*) filter (where signed_by_name is not null and length(trim(signed_by_name)) > 0) as has_signed_name,
  count(*) filter (where payment_gateway = 'shopify_payments') as shopify_payments_orders,
  count(*) filter (where three_ds_authenticated is true) as tds_true,
  count(distinct payment_gateway) as distinct_gateways
from shopify_orders, s where shop_id = s.sid;
