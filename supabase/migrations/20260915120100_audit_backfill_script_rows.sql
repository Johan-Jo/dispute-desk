-- 20260915120100: relabel 8 historical build-one-pack.mjs rows merchant -> script
--
-- These rows say a merchant queued a pack rebuild. No merchant did. They are
-- scripts/build-one-pack.mjs runs, which hardcoded actor_type 'merchant'
-- because no truthful value existed until 20260915120000.
--
-- APPEND-ONLY. audit_events carries trg_audit_no_update / trg_audit_no_delete
-- (reject_audit_mutation()) so this cannot be a plain UPDATE. It uses the
-- SANCTIONED escape hatch established by 20260509130000: the transaction-local
-- GUC `app.allow_audit_mutation`, which reject_audit_mutation() honours.
--
-- Deliberately NOT `alter table ... disable trigger`: that lifts immutability
-- table-wide for the duration, so any concurrent writer would also slip past
-- it. `set_config(..., true)` is scoped to THIS transaction and nothing else,
-- and it reverts on commit or rollback without a re-enable step that could be
-- skipped on an error path. See docs/technical.md "E2E fixtures and audit
-- immutability".
--
-- SCOPE. Matched by the script's own note payload, not by shop or date:
--   actor_type='merchant' AND event_type='job_queued'
--   AND event_payload->>'note' ILIKE '%build-one-pack.mjs%'
-- Expected: exactly 8 rows, all shop ea035a1b, 2026-09-01 .. 2026-09-08.
--
-- Two OTHER merchant job_queued rows exist (shop e5da0042, April 2026,
-- payloads {trigger: manual_generate} and {jobType: render_pdf}). Those are
-- real merchant actions and the predicate deliberately excludes them -- they
-- carry no `note`. The assertion below is what stops this from silently
-- over-matching if that ever stops being true.
do $$
declare
  matched integer;
begin
  select count(*) into matched
  from audit_events
  where actor_type = 'merchant'
    and event_type = 'job_queued'
    and event_payload->>'note' ilike '%build-one-pack.mjs%';

  -- Prod carries exactly 8 such rows (verified 2026-09-15). Dev and any
  -- freshly-restored environment carry 0 -- nothing to fix is a valid state,
  -- and a migration that aborts there would block the whole deploy. Any
  -- OTHER count means the predicate no longer means what it meant when this
  -- was written, and a silent over-match would rewrite real merchant
  -- actions. That is the case worth refusing.
  if matched = 0 then
    raise notice 'audit backfill: no build-one-pack.mjs rows here, nothing to do';
    return;
  end if;

  if matched <> 8 then
    raise exception
      'audit backfill aborted: expected 8 build-one-pack.mjs rows (or 0), found %. '
      'Re-verify the predicate against live data before re-running.', matched;
  end if;

  -- Transaction-local: reverts automatically, and never widens past this txn.
  perform set_config('app.allow_audit_mutation', 'on', true);

  update audit_events
  set actor_type = 'script',
      actor_id   = 'build-one-pack.mjs'
  where actor_type = 'merchant'
    and event_type = 'job_queued'
    and event_payload->>'note' ilike '%build-one-pack.mjs%';

  raise notice 'audit backfill: relabelled % rows merchant -> script', matched;
end $$;
