-- Transactional test for the stale-lock reclaim in claim_jobs
-- (migration 20260702150000_claim_jobs_stale_lock_reclaim.sql).
--
-- Safe to run against any environment: everything happens inside a
-- BEGIN…ROLLBACK, so no rows survive. A failed assertion RAISEs and
-- aborts; the trailing ROLLBACK still unwinds the aborted txn.
--
--   npx supabase db query --linked --file scripts/sql/test-claim-jobs-reclaim.sql
--
-- Expected tail output: NOTICE  claim_jobs reclaim: ALL 5 SCENARIOS PASS
--
-- Scenarios:
--   1. stale running + attempts remaining        → 'queued', lock cleared, entity_id kept
--   2. stale running + attempts exhausted         → 'failed'
--   3. fresh running (lock young)                 → untouched ('running')
--   4. stale job frees the per-shop slot          → a queued successor gets claimed
--   5. a plain queued job (no stale)              → still claimable after the reclaim step

begin;

do $$
declare
  v_shop_a uuid;   -- holds scenarios 1/2/3 (a fresh running job occupies its slot)
  v_shop_b uuid;   -- scenario 4: slot-freeing
  v_shop_c uuid;   -- scenario 5: normal queued
  v_job_1 uuid;    -- stale, attempts remaining
  v_job_2 uuid;    -- stale, attempts exhausted
  v_job_3 uuid;    -- fresh running
  v_job_b_stale uuid;
  v_job_b_queued uuid;
  v_job_c_queued uuid;
  v_status text;
  v_entity text;
  v_locked_at timestamptz;
  v_running_count int;
  v_audit_count int;
begin
  -- ── Fixtures ─────────────────────────────────────────────────────
  insert into shops (shop_domain) values ('reclaim-test-a.myshopify.test') returning id into v_shop_a;
  insert into shops (shop_domain) values ('reclaim-test-b.myshopify.test') returning id into v_shop_b;
  insert into shops (shop_domain) values ('reclaim-test-c.myshopify.test') returning id into v_shop_c;

  -- Shop A: one FRESH running job (holds the single slot) + two STALE running jobs.
  insert into jobs (shop_id, job_type, status, locked_at, locked_by, attempts, max_attempts, entity_id)
    values (v_shop_a, 'backfill_shop_orders', 'running', now() - interval '30 seconds', 'worker-fresh', 1, 3, 'cursor-fresh')
    returning id into v_job_3;
  insert into jobs (shop_id, job_type, status, locked_at, locked_by, attempts, max_attempts, entity_id)
    values (v_shop_a, 'backfill_shop_orders', 'running', now() - interval '20 minutes', 'worker-dead-1', 1, 3, 'cursor-resume-here')
    returning id into v_job_1;
  insert into jobs (shop_id, job_type, status, locked_at, locked_by, attempts, max_attempts, entity_id)
    values (v_shop_a, 'backfill_shop_orders', 'running', now() - interval '20 minutes', 'worker-dead-2', 3, 3, 'cursor-exhausted')
    returning id into v_job_2;

  -- Shop B: one STALE running job (occupies the slot) + one queued successor.
  insert into jobs (shop_id, job_type, status, locked_at, locked_by, attempts, max_attempts)
    values (v_shop_b, 'backfill_shop_orders', 'running', now() - interval '20 minutes', 'worker-dead-b', 1, 3)
    returning id into v_job_b_stale;
  insert into jobs (shop_id, job_type, status, priority)
    values (v_shop_b, 'backfill_shop_orders', 'queued', 80)
    returning id into v_job_b_queued;

  -- Shop C: a plain queued job, no stale jobs at all.
  insert into jobs (shop_id, job_type, status)
    values (v_shop_c, 'sync_disputes', 'queued')
    returning id into v_job_c_queued;

  -- ── Act ──────────────────────────────────────────────────────────
  perform claim_jobs('test-worker', 10, 1, 600);

  -- ── Scenario 1: stale + attempts remaining → queued, lock cleared, cursor kept ──
  select status, entity_id, locked_at into v_status, v_entity, v_locked_at from jobs where id = v_job_1;
  if v_status <> 'queued' then raise exception 'S1 FAIL: expected queued, got %', v_status; end if;
  if v_locked_at is not null then raise exception 'S1 FAIL: locked_at not cleared (%)', v_locked_at; end if;
  if v_entity <> 'cursor-resume-here' then raise exception 'S1 FAIL: entity_id (cursor) not preserved, got %', v_entity; end if;

  -- ── Scenario 2: stale + attempts exhausted → failed ──
  select status into v_status from jobs where id = v_job_2;
  if v_status <> 'failed' then raise exception 'S2 FAIL: expected failed, got %', v_status; end if;

  -- ── Scenario 3: fresh running → untouched ──
  select status, locked_by into v_status, v_entity from jobs where id = v_job_3;
  if v_status <> 'running' then raise exception 'S3 FAIL: fresh job was reclaimed (status=%)', v_status; end if;
  if v_entity <> 'worker-fresh' then raise exception 'S3 FAIL: fresh job lock owner changed (%)', v_entity; end if;

  -- ── Scenario 4: reclaim frees shop B's slot → exactly one B job now running ──
  select count(*) into v_running_count from jobs where shop_id = v_shop_b and status = 'running';
  if v_running_count <> 1 then
    raise exception 'S4 FAIL: expected exactly 1 running job in shop B after reclaim+claim, got %', v_running_count;
  end if;
  -- and the formerly-stale job must have been released (not still running)
  select status into v_status from jobs where id = v_job_b_stale;
  if v_status = 'running' then raise exception 'S4 FAIL: stale job in shop B still running'; end if;

  -- ── Scenario 5: plain queued job still claimable after the reclaim step ──
  select status into v_status from jobs where id = v_job_c_queued;
  if v_status <> 'running' then raise exception 'S5 FAIL: normal queued job not claimed (status=%)', v_status; end if;

  -- ── Observability: audit rows for the two reclaimed shop-A jobs ──
  select count(*) into v_audit_count
    from audit_events
    where shop_id = v_shop_a and event_type = 'job_lock_reclaimed';
  if v_audit_count <> 2 then
    raise exception 'AUDIT FAIL: expected 2 job_lock_reclaimed rows for shop A, got %', v_audit_count;
  end if;
  -- payload sanity: the reclaim of job_1 must record its prior lock owner.
  perform 1 from audit_events
    where event_type = 'job_lock_reclaimed'
      and (event_payload->>'job_id')::uuid = v_job_1
      and event_payload->>'prior_locked_by' = 'worker-dead-1'
      and event_payload->>'reason' = 'lock_expired'
      and event_payload->>'new_status' = 'queued';
  if not found then raise exception 'AUDIT FAIL: job_1 reclaim payload missing/incorrect'; end if;

  raise notice 'claim_jobs reclaim: ALL 5 SCENARIOS PASS';
end $$;

rollback;
