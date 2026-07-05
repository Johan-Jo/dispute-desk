-- Do the Performance Overview KPIs actually vary by period window?
-- computeDisputeMetrics filters `list` by created_at >= periodFrom.
-- cay-collective's whole history imported 2026-07-02, so created_at is
-- a useless discriminator. Compare created_at-windowing (current, broken)
-- vs initiated_at-windowing (the real dispute date) for each window.

with s as (
  select id from shops where shop_domain ilike '%cay-collective%'
),
base as (
  select
    normalized_status, final_outcome, amount, currency_code,
    outcome_amount_recovered, outcome_amount_lost,
    created_at, initiated_at
  from disputes
  where shop_id in (select id from s)
),
active_set as (
  -- mirror ACTIVE_NORMALIZED in lib/disputes/metrics.ts
  select unnest(array[
    'new','in_progress','needs_review','ready_to_submit','action_needed',
    'submitted','submitted_to_shopify','waiting_on_issuer','submitted_to_bank'
  ]) as ns
)
select
  w.win,
  w.field,
  -- Active disputes count (all currencies)
  count(*) filter (
    where b.normalized_status in (select ns from active_set)
      and (w.field='created' and b.created_at >= w.since
           or w.field='initiated' and b.initiated_at >= w.since
           or w.since is null)
  ) as active,
  -- Won / Lost
  count(*) filter (
    where b.final_outcome='won'
      and (w.field='created' and b.created_at >= w.since
           or w.field='initiated' and b.initiated_at >= w.since
           or w.since is null)
  ) as won,
  count(*) filter (
    where b.final_outcome='lost'
      and (w.field='created' and b.created_at >= w.since
           or w.field='initiated' and b.initiated_at >= w.since
           or w.since is null)
  ) as lost,
  -- Amount recovered (primary-currency approximation: sum all here for trend)
  round(sum(b.outcome_amount_recovered) filter (
    where (w.field='created' and b.created_at >= w.since
           or w.field='initiated' and b.initiated_at >= w.since
           or w.since is null)
  ),0) as recovered_all_ccy
from base b
cross join (
  values
    ('24h','created', now()-interval '24 hours'),
    ('7d','created',  now()-interval '7 days'),
    ('30d','created', now()-interval '30 days'),
    ('all','created', null::timestamptz),
    ('24h','initiated', now()-interval '24 hours'),
    ('7d','initiated',  now()-interval '7 days'),
    ('30d','initiated', now()-interval '30 days'),
    ('all','initiated', null::timestamptz)
) as w(win, field, since)
group by w.win, w.field
order by w.field, (case w.win when '24h' then 1 when '7d' then 2 when '30d' then 3 else 4 end);
