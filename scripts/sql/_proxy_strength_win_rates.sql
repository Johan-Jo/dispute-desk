-- Proxy for evidence strength on historical adjudicated+responded disputes (Blume):
-- delivery confirmation is the closest measurable stand-in for a strong signal.
select
  case when reason in ('FRAUDULENT','UNRECOGNIZED') then 'fraud' else 'non_fraud' end as family,
  coalesce(order_delivery_status, 'unknown') as delivery,
  count(*) as n,
  count(*) filter (where final_outcome = 'won') as won,
  round(100.0 * count(*) filter (where final_outcome = 'won') / count(*), 1) as win_pct
from intel_dispute_records
where final_outcome in ('won','lost')
  and submitted_at is not null
group by 1, 2
order by 1, 2;
