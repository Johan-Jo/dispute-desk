-- 20260702150000: stale-lock reclaim inside claim_jobs
--
-- Root cause (cay-collective, 2026-07-02): a `backfill_shop_orders` job
-- died mid-page and was frozen in status='running' with locked_at set.
-- The prior claim_jobs (008) only ever looked at status='queued' rows,
-- and the per-shop concurrency cap counts status='running' rows — so one
-- zombie running job permanently occupied the shop's single slot and
-- wedged the entire pipeline. Even a manually re-enqueued successor could
-- never be claimed. This was systemic: any worker death (OOM / 300s
-- maxDuration timeout / redeploy mid-run) could wedge a shop forever.
-- See docs/plans/stuck-backfill-job-and-gap-recovery.plan.md.
--
-- Fix: before the normal claim loop, reclaim any job that has been
-- 'running' longer than p_lock_timeout_seconds (presumed dead). Jobs with
-- attempts remaining go back to 'queued'; jobs that already exhausted
-- max_attempts are parked 'failed' so a genuinely broken job can't loop
-- forever.
--
-- Why `attempts < max_attempts` is safe here: attempts is incremented at
-- CLAIM time (the claim UPDATE below does `attempts = attempts + 1`). A
-- job that is currently 'running' therefore already had this run counted.
-- We do NOT re-increment on reclaim — the next claim will — so the bound
-- is honest and monotonic: max_attempts distinct claims, then 'failed'.
--
-- The reclaim runs FIRST, so the zombie leaves 'running' before the
-- per-shop concurrency count is evaluated in the same call — the freed
-- slot is immediately usable by a queued successor. entity_id (the
-- Shopify pagination cursor) is preserved on the reclaimed row, so a
-- reclaimed backfill resumes from exactly where it stalled. persistOrders
-- and upsertSignalRow are idempotent, so re-running the in-flight page is
-- safe (no double-import).
--
-- Observability: every reclaimed job writes one append-only audit_events
-- row (event_type='job_lock_reclaimed') carrying reason, job/shop ids, the
-- prior lock owner + timestamp, and the attempt counters — so worker-death
-- frequency and wedged-pipeline recovery are queryable.

-- Adding a 4th parameter changes the function arity, which creates a NEW
-- overload rather than replacing 008's 3-arg version (CREATE OR REPLACE
-- only replaces an identical signature). Drop the old overload so a single
-- definition exists and callers can't silently resolve to the pre-reclaim
-- function.
drop function if exists claim_jobs(text, int, int);

create or replace function claim_jobs(
  p_worker_id text,
  p_limit int default 5,
  p_max_concurrent int default 1,
  p_lock_timeout_seconds int default 600
)
returns setof jobs
language plpgsql
as $$
declare
  v_job jobs;
begin
  -- ── Stale-lock reclaim ─────────────────────────────────────────
  -- A 'running' job whose lock is older than the timeout is presumed
  -- dead. `for update skip locked` on the stale set means two workers
  -- overlapping in time never both reclaim the same row. The prior
  -- locked_by / locked_at are captured from the `stale` CTE *before* the
  -- UPDATE nulls them, so the audit row records who held the dead lock.
  with stale as (
    select id, shop_id, job_type, locked_by, locked_at, attempts, max_attempts
    from jobs
    where status = 'running'
      and locked_at is not null
      and locked_at < now() - make_interval(secs => p_lock_timeout_seconds)
    for update skip locked
  ),
  reclaimed as (
    update jobs j
    set status = case when j.attempts < j.max_attempts then 'queued' else 'failed' end,
        locked_at = null,
        locked_by = null,
        last_error = coalesce(j.last_error, 'reclaimed: lock expired'),
        run_at = now(),
        updated_at = now()
    from stale
    where j.id = stale.id
    returning
      stale.id           as job_id,
      stale.shop_id      as shop_id,
      stale.job_type     as job_type,
      stale.locked_by    as prior_locked_by,
      stale.locked_at    as prior_locked_at,
      stale.attempts     as attempts,
      stale.max_attempts as max_attempts,
      j.status           as new_status
  )
  insert into audit_events (shop_id, actor_type, actor_id, event_type, event_payload)
  select
    r.shop_id,
    'system',
    'claim_jobs',
    'job_lock_reclaimed',
    jsonb_build_object(
      'reason', 'lock_expired',
      'job_id', r.job_id,
      'job_type', r.job_type,
      'shop_id', r.shop_id,
      'prior_locked_by', r.prior_locked_by,
      'prior_locked_at', r.prior_locked_at,
      'attempts', r.attempts,
      'max_attempts', r.max_attempts,
      'new_status', r.new_status,
      'lock_timeout_seconds', p_lock_timeout_seconds
    )
  from reclaimed r;

  -- ── Normal claim loop ──────────────────────────────────────────
  -- The WHERE subquery pre-filters shops that already have a running job
  -- from an EARLIER tick — now honest, because the reclaim step above
  -- flipped any stale zombie out of 'running'.
  for v_job in
    select j.*
    from jobs j
    where j.status = 'queued'
      and j.run_at <= now()
      and (
        select count(*)
        from jobs j2
        where j2.shop_id = j.shop_id
          and j2.status = 'running'
      ) < p_max_concurrent
    order by j.priority asc, j.run_at asc
    limit p_limit
    for update skip locked
  loop
    -- Re-check the per-shop cap INSIDE the loop. The WHERE subquery is
    -- evaluated once against the pre-loop snapshot, so when a shop has
    -- multiple 'queued' jobs (common now that reclaim re-queues a stalled
    -- job alongside any successor) it sees 0 running and passes them ALL,
    -- which would let one call claim two jobs for the same shop and break
    -- the max-1-per-shop invariant. UPDATEs from earlier iterations of
    -- this same loop ARE visible here, so re-counting closes that hole.
    -- The skipped row stays 'queued' (its lock releases at function end)
    -- and is claimed on a later tick once the shop's slot frees.
    if (
      select count(*)
      from jobs j2
      where j2.shop_id = v_job.shop_id
        and j2.status = 'running'
    ) >= p_max_concurrent then
      continue;
    end if;

    update jobs
    set status = 'running',
        locked_at = now(),
        locked_by = p_worker_id,
        attempts = attempts + 1,
        updated_at = now()
    where id = v_job.id;

    v_job.status := 'running';
    v_job.locked_at := now();
    v_job.locked_by := p_worker_id;
    v_job.attempts := v_job.attempts + 1;

    return next v_job;
  end loop;
end;
$$;

-- Re-pin search_path on the new signature. `drop function` above discarded
-- the pin that 20260515120000_p0_security_lockdown.sql set on the old
-- 3-arg version; without this the function_search_path_mutable lint fires.
-- EXECUTE defaults (granted to PUBLIC) are unchanged — the lockdown never
-- revoked EXECUTE on claim_jobs, so the drop+recreate restores the same
-- grants.
alter function public.claim_jobs(text, integer, integer, integer)
  set search_path = public, pg_temp;
