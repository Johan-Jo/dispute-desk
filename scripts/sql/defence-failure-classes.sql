-- Defence packages that produced no letter, counted by cause.
--
--   npm run db:query:prod -- --file scripts/sql/defence-failure-classes.sql --output table
--
-- One row per signature (failure_signature, written since 2026-10-09; older
-- rows fall back to their failure_code), newest and most urgent first:
--
--   n / disputes      rows and distinct disputes, all time
--   n_14d / n_3d      recent volume
--   actionable_open   disputes that still need a response, with a future
--                     deadline, whose LATEST package is this outcome
--   next_due          the earliest of those deadlines
--
-- A signature reads `code · module · brief · payment family · detail · rules`
-- with absent parts dropped (lib/defence/outcomes.ts `failureSignature`).
-- Plan: docs/plans/defence-package-failure-classes.plan.md.

with latest as (
  select distinct on (dp.dispute_id) dp.id, dp.dispute_id
  from defence_packages dp
  order by dp.dispute_id, dp.version desc
)
select
  dp.status,
  coalesce(dp.failure_signature, dp.failure_code, '-')                          as signature,
  count(*)                                                                      as n,
  count(distinct dp.dispute_id)                                                 as disputes,
  count(*) filter (where dp.created_at > now() - interval '14 days')            as n_14d,
  count(*) filter (where dp.created_at > now() - interval '3 days')             as n_3d,
  count(distinct dp.dispute_id) filter (
    where l.id is not null and d.status = 'needs_response' and d.due_at > now()
  )                                                                             as actionable_open,
  min(d.due_at) filter (
    where l.id is not null and d.status = 'needs_response' and d.due_at > now()
  )                                                                             as next_due,
  string_agg(distinct s.shop_domain, ', ')                                      as shops,
  max(dp.created_at)::date                                                      as last_seen
from defence_packages dp
join disputes d on d.id = dp.dispute_id
join shops s on s.id = dp.shop_id
left join latest l on l.id = dp.id
where dp.status in ('failed', 'skipped')
group by 1, 2
order by actionable_open desc, n_3d desc, n_14d desc, n desc;
