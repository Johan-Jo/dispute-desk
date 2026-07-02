-- Fleet sweep: is any shop wedged by a stale 'running' job or a stalled
-- historical import? Read-only. Run against prod (confirm ref per §0):
--   npx supabase db query --linked --file scripts/sql/sweep-stale-running-jobs.sql
--
-- Every row in the first result is a pipeline that the deployed reclaim
-- (migration 20260702150000) will auto-recover on the next worker tick.
-- Rows that persist across ticks indicate a job that keeps dying on claim
-- (attempts climbing toward max_attempts → will be parked 'failed').

-- 1. Jobs stuck 'running' longer than the 600s reclaim timeout.
select
  shop_id,
  id            as job_id,
  job_type,
  attempts,
  max_attempts,
  locked_by,
  locked_at,
  round(extract(epoch from (now() - locked_at)))::int as stuck_seconds,
  entity_id
from jobs
where status = 'running'
  and locked_at < now() - interval '10 minutes'
order by locked_at asc;

-- 2. Shops whose historical import never completed and hasn't advanced
--    recently — candidates that stalled before this fix existed.
select
  s.id            as shop_id,
  s.shop_domain,
  s.historical_import_status,
  s.historical_import_orders_processed,
  s.historical_import_since_date,
  s.updated_at,
  (select count(*) from jobs j
     where j.shop_id = s.id
       and j.job_type = 'backfill_shop_orders'
       and j.status in ('queued','running')) as open_backfill_jobs
from shops s
where s.historical_import_status = 'in_progress'
order by s.updated_at asc;
