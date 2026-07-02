-- Manual reclaim of cay-collective's stuck backfill_shop_orders job.
--
-- PROD ONLY. Confirm the linked ref is prod (aokhplydttxtebvbeuzc) per
-- CLAUDE.md §0 BEFORE running:
--   cat supabase/.temp/linked-project.json
--   npx supabase db query --linked --file scripts/sql/reclaim-cay-collective-stuck-job.sql
--
-- Preferred recovery per Plan A: reclaim the ORIGINAL stuck row to
-- 'queued' (do NOT fail it + enqueue a duplicate). Its entity_id still
-- holds the Shopify pagination cursor
-- ({"last_id":7356534817034,"last_value":"2025-09-11 12:43:15"}), so the
-- next worker tick resumes the walk from exactly where it stalled and
-- fills the 2025-10 → 2026-05 dead band. persistOrders / upsertSignalRow
-- are idempotent, so re-running the in-flight page is safe.
--
-- After the migration 20260702150000 ships, this job auto-reclaims on the
-- next worker tick (locked ~52m ≫ 600s timeout). This script is the
-- before-deploy manual path.
--
-- Guard: the `and status = 'running'` clause makes this a no-op if the job
-- was already reclaimed (by the deployed RPC or a prior run of this file).

update jobs
set status = 'queued',
    locked_at = null,
    locked_by = null,
    last_error = 'manual reclaim 2026-07-02: stuck running past timeout',
    run_at = now(),
    updated_at = now()
where id = '9752b96b-b22c-4411-bc61-aeacd36320df'
  and status = 'running'
returning id, shop_id, job_type, status, entity_id, run_at;
