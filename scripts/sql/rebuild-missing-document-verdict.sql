-- Rebuild open cases whose newest defence package carries NO document verdict.
--
-- WHY THIS EXISTS. `selectFileablePackage` rung 9 refuses any candidate whose
-- `document_validation_passed` is not exactly `true` — "never run is not
-- evidence of passing". Until 2026-08-15 that column was written only under the
-- activation flag, so every package built while dark carries NULL, and
-- activation would have answered `validation_failed` for all of them. Same
-- deadlock as the identity one, one column over.
--
-- The code fix (#577/#578) makes the check RUN while dark, so a rebuild now
-- stamps a real verdict. This sweeps the packages built before that shipped.
--
-- WHY REBUILD RATHER THAN BACKFILL THE COLUMN. Recomputing the verdict outside
-- the build job means reconstructing the plan, the canonical fact selection,
-- the projection and the composed blocks by hand — and the fact selection is
-- exactly where the in-job version was nearly wrong (`planFacts` still holds
-- the LEGACY list while dark; projecting the canonical plan over it yields a
-- hybrid belonging to neither route). A verdict written in bulk from a
-- reconstruction that is subtly wrong is worse than the generation cost, and it
-- lands in the one column rung 9 trusts absolutely.
--
-- Check the budget before raising the LIMIT: `readGenerationBudget` binds on
-- tokens, and retries draw from the same bucket.
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
  and d.evidence_saved_to_shopify_at is null
  and d.submission_state = 'not_saved'
  and dp.document_validation_passed is distinct from true
order by d.due_at asc
limit 60
returning id, entity_id, job_type, status;
