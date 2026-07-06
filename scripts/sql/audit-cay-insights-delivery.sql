-- Insights delivery/confirmation audit for cay-collective (prod).
-- Mirrors the KPI logic in app/api/dashboard/insights/initial-analysis:
--   confirmed = delivery_status='Delivered' OR delivered_at_tracking IS NOT NULL
--   denominators keyed on processed_at window + fulfilled_at.
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid),
o as (select * from shopify_orders, s where shop_id = s.sid)
select
  -- delivery_status distribution (all-time)
  (select json_object_agg(coalesce(delivery_status,'(null)'), c)
     from (select delivery_status, count(*) c from o group by delivery_status) d) as delivery_status_dist,
  (select json_object_agg(coalesce(tracking_source,'(null)'), c)
     from (select tracking_source, count(*) c from o group by tracking_source) t) as tracking_source_dist,
  -- ALL-TIME confirmed-delivery
  count(*) filter (where fulfilled_at is not null) as fulfilled_all_time,
  count(*) filter (where fulfilled_at is not null
                   and (delivery_status='Delivered' or delivered_at_tracking is not null)) as confirmed_all_time,
  count(*) filter (where delivery_status='DeliveredToPickup') as pickup_all_time,
  count(*) filter (where delivery_status='Returned') as returned_all_time,
  count(*) filter (where signed_by_name is not null and length(trim(signed_by_name))>0) as signed_all_time,
  -- LAST 30 DAYS (KPI window: processed_at >= now()-30d)
  count(*) filter (where fulfilled_at is not null and processed_at >= now()-interval '30 days') as fulfilled_30d,
  count(*) filter (where fulfilled_at is not null and processed_at >= now()-interval '30 days'
                   and (delivery_status='Delivered' or delivered_at_tracking is not null)) as confirmed_30d
from o;
