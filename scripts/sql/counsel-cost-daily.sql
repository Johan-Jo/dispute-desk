-- Counsel v2 letter cost per package per day (cost refactor §6).
-- Run: npm run db:query:prod -- --file scripts/sql/counsel-cost-daily.sql --output table
--
-- Prices (USD per million tokens) match lib/defence/counsel/cost.ts — change both.
-- Reused letters (stage_tokens = []) are $0 packages. Rows before the refactor
-- (stage_tokens is null) are left out: their cost is not computable per call.
with stages as (
  select r.daily_bucket, r.package_id, r.strategy_keys, s
  from defence_package_runs r
  left join lateral jsonb_array_elements(r.stage_tokens) s on true
  where r.stage_tokens is not null
    and r.strategy_keys && array['counsel_v2', 'counsel_v2_reused']
    and r.daily_bucket >= current_date - 30
),
priced as (
  select daily_bucket, package_id, strategy_keys,
    case when s is null then 0 else
      ((s->>'input')::numeric * p.i + (s->>'output')::numeric * p.o
       + (s->>'cacheRead')::numeric * p.cr + (s->>'cacheWrite')::numeric * p.cw) / 1e6
    end as usd,
    case when s is null then 0 else 1 end as calls
  from stages
  left join lateral (
    select * from (values
      ('claude-sonnet-4-6', 3.0, 15.0, 0.30, 3.75),
      ('claude-haiku-4-5', 1.0, 5.0, 0.10, 1.25)
    ) v(model, i, o, cr, cw)
    where v.model = coalesce(s->>'model', 'claude-sonnet-4-6')
    union all
    -- An unlisted model is priced as the writer model, never as free.
    select 'other', 3.0, 15.0, 0.30, 3.75
    where coalesce(s->>'model', 'claude-sonnet-4-6') not in ('claude-sonnet-4-6', 'claude-haiku-4-5')
  ) p on true
),
per_package as (
  select daily_bucket, package_id,
    sum(usd) as usd,
    sum(calls) as calls,
    bool_or('counsel_v2_reused' = any(strategy_keys)) as reused
  from priced
  group by daily_bucket, package_id
)
select daily_bucket as day,
  count(*) as packages,
  count(*) filter (where reused) as reused,
  round(avg(calls), 1) as avg_calls,
  round(sum(usd), 4) as total_usd,
  round(percentile_cont(0.5) within group (order by usd)::numeric, 4) as median_usd,
  round(percentile_cont(0.9) within group (order by usd)::numeric, 4) as p90_usd,
  percentile_cont(0.5) within group (order by usd) > 0.05 as over_budget
from per_package
group by daily_bucket
order by daily_bucket desc;
