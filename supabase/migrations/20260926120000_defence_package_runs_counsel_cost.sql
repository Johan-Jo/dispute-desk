-- Counsel v2 cost refactor — telemetry (docs/plans/counsel-v2-cost-refactor.plan.md §6)
--
-- The first production counsel run cost ~$0.45 per package and nobody could
-- see it from the runs table: prompt_tokens is one number per run, with no
-- split by call, by model or by cache use. These two columns make a run's
-- cost computable in SQL (scripts/sql/counsel-cost-daily.sql and the
-- counsel-cost-monitor cron):
--
--   cached_tokens — prompt-cache reads across the run (billed at 0.1× input).
--   stage_tokens  — one entry per model call:
--                   { stage: write|review|correction, model, input, output,
--                     cacheRead, cacheWrite }
--                   An empty array on a counsel run means the letter was
--                   reused and no model was called (strategy_keys =
--                   {counsel_v2_reused}).
--
-- Both nullable: template-writer runs and every pre-refactor row leave them
-- null. Additive only.

alter table defence_package_runs
  add column if not exists cached_tokens int,
  add column if not exists stage_tokens jsonb;

comment on column defence_package_runs.cached_tokens is
  'Counsel v2: prompt-cache read tokens across the run. Null on template-writer runs and pre-2026-09-26 rows.';
comment on column defence_package_runs.stage_tokens is
  'Counsel v2: per-call usage [{stage, model, input, output, cacheRead, cacheWrite}]. [] = reused letter, no model call. Null on template-writer runs.';
