-- Audit cay-collective dashboard top-line cards:
--   "Waiting on Issuer" (normalized_status IN waiting_on_issuer, submitted_to_bank, NOT closed)
--   "Closed" card (metrics.totalClosed = created_at in period AND closed_at not null)
-- Question: are these counts real, and do they respond to the period selector?

with s as (
  select id from shops where shop_domain ilike '%cay-collective%'
)
-- 1) normalized_status breakdown for OPEN (non-closed) disputes -> drives the 3 operational cards
select
  '1_open_status_breakdown' as section,
  coalesce(normalized_status, 'new') as bucket,
  count(*)                            as n
from disputes
where shop_id in (select id from s)
  and closed_at is null
group by coalesce(normalized_status, 'new')

union all

-- 2) "Waiting on Issuer" exact card value (open only)
select
  '2_waiting_on_issuer_card' as section,
  'waiting_on_issuer+submitted_to_bank (open)' as bucket,
  count(*) as n
from disputes
where shop_id in (select id from s)
  and closed_at is null
  and normalized_status in ('waiting_on_issuer', 'submitted_to_bank')

union all

-- 3) Total closed_at is not null (all-time) vs the metrics window filter
select
  '3_closed_alltime' as section,
  'closed_at not null (all time)' as bucket,
  count(*) as n
from disputes
where shop_id in (select id from s)
  and closed_at is not null

union all

-- 4) metrics.totalClosed for 30d window = created_at >= now()-30d AND closed_at not null
select
  '4_closed_metrics_30d' as section,
  'created>=30d AND closed_at not null' as bucket,
  count(*) as n
from disputes
where shop_id in (select id from s)
  and closed_at is not null
  and created_at >= now() - interval '30 days'

union all

-- 5) metrics.totalClosed for 24h window
select
  '5_closed_metrics_24h' as section,
  'created>=24h AND closed_at not null' as bucket,
  count(*) as n
from disputes
where shop_id in (select id from s)
  and closed_at is not null
  and created_at >= now() - interval '24 hours'

union all

-- 6) metrics.totalClosed for 7d window
select
  '6_closed_metrics_7d' as section,
  'created>=7d AND closed_at not null' as bucket,
  count(*) as n
from disputes
where shop_id in (select id from s)
  and closed_at is not null
  and created_at >= now() - interval '7 days'

order by section, n desc;
