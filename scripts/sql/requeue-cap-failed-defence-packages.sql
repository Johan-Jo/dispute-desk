-- Requeue defence packages that failed on daily_cap_reached (per-shop LLM cap).
-- Run AFTER the UTC-midnight cap reset.
--
-- NOTE: an immutability trigger forbids failed → draft; the app path
-- (lib/defence/enqueue.ts case f) treats a failed row as "no prior" and
-- inserts a NEW draft at version+1 with the same source pack + evidence
-- hash, then enqueues build_defence_package. This mirrors that exactly.
-- Backfill priority 500 so requeues never starve interactive clicks.
-- Scoped to one shop via the where clause — adjust shop_id as needed.
with tofix as (
  select dp.id, dp.dispute_id, dp.shop_id, dp.source_pack_id, dp.version,
         dp.evidence_hash, dp.reason_code_module
    from defence_packages dp
   where dp.shop_id = '6648353c-422a-4ee5-8bba-d75fee284b09'
     and dp.status = 'failed'
     and dp.failure_code = 'daily_cap_reached'
     and dp.superseded_by_id is null
     -- only when the failed row is still the latest version for its dispute
     and not exists (
       select 1 from defence_packages newer
        where newer.dispute_id = dp.dispute_id
          and newer.version > dp.version
     )
),
ins as (
  insert into defence_packages
    (dispute_id, shop_id, source_pack_id, version, status, generated_by,
     evidence_hash, reason_code_module)
  select dispute_id, shop_id, source_pack_id, version + 1, 'draft', 'system',
         evidence_hash, reason_code_module
    from tofix
  returning id, shop_id
)
insert into jobs (shop_id, job_type, entity_id, priority)
select shop_id, 'build_defence_package', id, 500
  from ins
returning id;
