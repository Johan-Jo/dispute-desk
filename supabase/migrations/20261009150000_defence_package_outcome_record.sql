-- Defence packages: a stored, countable reason for every build that produced
-- no letter, and the writer's inputs for every counsel run.
--
-- Before this a rejected letter kept one generic sentence (`failure_reason`)
-- and the rules that rejected it went to the function log, which is kept for
-- a day; five unrelated skip exits shared one `failure_code`. See
-- docs/plans/defence-package-failure-classes.plan.md, Phase 0a.
--
--   outcome_detail       which exit a skip took and what the gate saw; for a
--                        counsel run, the brief, theory, argued sections,
--                        ledger claims and approved facts by category.
--   failure_signature    the grouping key failures and skips are counted by.
--   counsel_replay_json  the writer's inputs and its last draft. Server-side
--                        only: never selected for the browser.
--
-- All nullable, no backfill. The status-transition trigger is a deny-list of
-- columns on final/submitted rows and does not name these.

alter table defence_packages
  add column if not exists outcome_detail jsonb,
  add column if not exists failure_signature text,
  add column if not exists counsel_replay_json jsonb;

create index if not exists defence_packages_failure_signature_idx
  on defence_packages (failure_signature, created_at desc)
  where failure_signature is not null;
