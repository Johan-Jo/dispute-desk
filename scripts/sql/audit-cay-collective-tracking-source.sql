-- Has the tracking-metafield reader EVER matched anything for this shop?
-- tracking_source is only non-null when readTrackingMetafields() found
-- a KNOWN namespace with a usable signal. All-null => reader never matched.
with s as (select 'c497df8d-632d-49da-b385-eb523f57f341'::uuid as sid)
select
  coalesce(tracking_source, '(null)') as tracking_source,
  count(*) as orders
from shopify_orders, s
where shop_id = s.sid
group by 1
order by orders desc;
