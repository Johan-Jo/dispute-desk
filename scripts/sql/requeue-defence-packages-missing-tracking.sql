-- Rebuild defence packages that were generated BEFORE the tracking fix
-- (PR #497, 2026-08-03) for disputes where a tracking number exists.
--
-- Why: `factClassifier` read `p.carrier` (a key `fulfillmentSource` never
-- writes) and passed no tracking number or URL at all, so every package built
-- before the fix cites a delivery date with nothing the issuer can verify.
-- The carrier appeared in 0 of 142 packages, the number in 0 of 12 that had
-- one. Blume-box #345920's issuer response asked for exactly that number.
--
-- Only the DEFENCE PACKAGE is rebuilt, not the pack: the tracking data is
-- already in `evidence_packs` sections — the bug was in reading it. So this
-- reuses `source_pack_id` and `evidence_hash` unchanged, exactly as
-- requeue-cap-failed-defence-packages.sql does.
--
-- SCOPE — deliberately excludes:
--   * `submission_state = 'submitted_confirmed'` — Shopify already forwarded
--     to the issuer; the window is shut and a rebuild changes nothing.
--   * `submission_state = 'saved_to_shopify'` — Shopify holds the OLD PDF, so
--     a rebuild only helps if it is re-saved, and that is a merchant decision
--     (the regenerate prompt), not a silent backfill. One dispute, due
--     2026-08-28; handle it deliberately.
--   * closed / decided disputes (`final_outcome` or `closed_at` set).
--   * disputes whose latest pack has no tracking number — nothing to add.
--
-- An immutability trigger forbids editing a finalized row, so this inserts a
-- NEW draft at version+1 (the app path in lib/defence/enqueue.ts does the
-- same) and enqueues `build_defence_package`. The deadline cron picks the
-- newest version, so the rebuilt package is what gets filed.
--
-- Priority 500 = backfill lane, so this never starves an interactive click
-- (see JOB_PRIORITY_INTERACTIVE).
--
-- RUN ONLY AFTER THE FIX IS LIVE IN PRODUCTION — a rebuild on the old code
-- reproduces the same empty payload and burns the LLM budget for nothing.

with tracked as (
  -- Latest pack per dispute that carries a tracking number.
  select distinct on (p.dispute_id)
         p.dispute_id,
         p.id as pack_id,
         (jsonb_path_query_first(i.payload::jsonb,
            '$.fulfillments[*].tracking[*].number') #>> '{}') as tracking_number
    from evidence_packs p
    join evidence_items i on i.pack_id = p.id and i.type = 'shipping'
   order by p.dispute_id, p.created_at desc
),
eligible as (
  select dp.id, dp.dispute_id, dp.shop_id, dp.source_pack_id, dp.version,
         dp.evidence_hash, dp.reason_code_module
    from defence_packages dp
    join tracked t on t.dispute_id = dp.dispute_id
    join disputes d on d.id = dp.dispute_id
   where t.tracking_number is not null
     and d.final_outcome is null
     and d.closed_at is null
     and coalesce(d.submission_state, '') not in ('submitted_confirmed', 'saved_to_shopify')
     -- latest version only
     and not exists (
       select 1 from defence_packages newer
        where newer.dispute_id = dp.dispute_id
          and newer.version > dp.version
     )
     -- built before the fix shipped
     and dp.created_at < timestamptz '2026-08-03 00:00:00+00'
),
ins as (
  insert into defence_packages
    (dispute_id, shop_id, source_pack_id, version, status, generated_by,
     evidence_hash, reason_code_module)
  select dispute_id, shop_id, source_pack_id, version + 1, 'draft', 'system',
         evidence_hash, reason_code_module
    from eligible
  returning id, shop_id, dispute_id
)
insert into jobs (shop_id, job_type, entity_id, priority)
select shop_id, 'build_defence_package', id, 500 from ins
returning entity_id, shop_id;
