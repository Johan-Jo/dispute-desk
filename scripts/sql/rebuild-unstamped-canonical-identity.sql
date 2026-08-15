-- Rebuild open cases whose newest defence package carries NO canonical identity.
--
-- WHY REBUILD RATHER THAN BACKFILL. `plan_input_hash` is a hash of the inputs a
-- package was actually projected from. Stamping today's hash onto a package
-- built weeks ago would assert a provenance that never happened — and worse,
-- it would mark a genuinely stale package as fresh, which is a stronger lie
-- than the `snapshot_absent` we have now. The only honest way to give a package
-- a canonical identity is to build it under the canonical derivation.
--
-- Ordered by deadline so the most urgent are stamped first. Batched, not swept:
-- a rebuild runs evaluateAndMaybeAutoSave, so a pack that clears the gate is
-- filed to Shopify. Check the generation budget before raising the LIMIT —
-- `readGenerationBudget` binds on tokens (50 000 / ~1 400 ≈ 35 per shop-day),
-- and retries draw from the same bucket.
insert into jobs (shop_id, job_type, entity_id)
select p.shop_id, 'build_pack', p.id
from disputes d
join lateral (
  select ep.* from evidence_packs ep
  where ep.dispute_id = d.id and ep.status = 'ready'
  order by ep.created_at desc limit 1
) p on true
join lateral (
  select x.* from defence_packages x
  where x.dispute_id = d.id
  order by x.version desc limit 1
) dp on true
where d.closed_at is null
  -- BOTH filed-checks, deliberately. `evidence_saved_to_shopify_at` records
  -- that *we* saved; `submission_state` records what Shopify reports. They
  -- disagree on any case filed outside our save path — measured 2026-08-15,
  -- dispute 11081842881 was `submitted_confirmed` with a NULL timestamp, so a
  -- timestamp-only filter spent a generation rebuilding an already-filed,
  -- past-deadline case. The auto-save gate blocked it, so nothing was
  -- double-filed, but the budget was gone.
  and d.evidence_saved_to_shopify_at is null
  and d.submission_state = 'not_saved'
  and dp.plan_input_hash is null
order by d.due_at asc
limit 25
returning id, entity_id, job_type, status, created_at;
