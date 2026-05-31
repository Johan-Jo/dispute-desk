-- Release smoke log
--
-- Append-only table that records every release dry-run / actual prod
-- push. Each future migration file that wants to participate in the
-- smoke mechanism ships an INSERT into this table with the current
-- release's git SHA and the env identifier.
--
-- This first migration just creates the table. No product schema is
-- added or dropped — the only purpose is to give release dry-runs an
-- accretive, idempotent surface to write through.
--
-- Reference: docs/plans/dev-prod-environment-split.plan.md §Phase 6.

CREATE TABLE IF NOT EXISTS public.release_smoke_log (
  id          bigserial PRIMARY KEY,
  git_sha     text NOT NULL,
  env         text NOT NULL,
  ran_at      timestamptz NOT NULL DEFAULT now()
);

-- RLS-enable with no policies. The table is service-role-only by design;
-- merchants and the anon role should never see it.
ALTER TABLE public.release_smoke_log ENABLE ROW LEVEL SECURITY;

-- Future per-release migration files write an INSERT here. Example
-- (DO NOT add to this migration — add to a NEW migration file per
-- release):
--
--   INSERT INTO public.release_smoke_log (git_sha, env)
--   VALUES ('<7-char-sha>', current_setting('app.env', true));
--
-- The Supabase CLI tracks applied migrations by filename, so re-running
-- a release-smoke migration is a no-op even though INSERT itself is not
-- idempotent.
