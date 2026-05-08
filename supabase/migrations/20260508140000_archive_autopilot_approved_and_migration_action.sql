-- PR 5 — Migration rewrite queue + autopilot Tier-A safeguards.
--
-- content_archive_items.autopilot_approved
--   Default false. When false AND the archive row resolves to Tier A
--   (is_hub_article = true OR tier_override = 'A' OR content_type = 'pillar_page'),
--   the autopilot picker skips the row. Tier B/C rows are unaffected by this
--   flag (default false is fine because they're allowed to run without
--   explicit approval).
--
-- content_localizations.migration_action
--   Editorial intent flag for the rewrite queue. Admin marks each
--   per-locale article with one of:
--     keep        — leave as-is
--     expand      — needs more depth at current tier
--     merge       — to be merged into another article (admin then sets
--                    redirect_to_localization_id manually)
--     redirect    — already redirected (canonical lives elsewhere)
--     noindex     — exclude from sitemap (admin sets is_excluded_from_sitemap)
--     rewrite_b   — rewrite at Tier B
--     rewrite_c   — rewrite at Tier C
--     promote_a   — rewrite at Tier A and mark item as the canonical hub pillar
--   The flag itself does not execute — it is a workflow signal. PR 6 (Tier A
--   pillar generation) reads it; admin tooling acts on `redirect` / `noindex`
--   via the existing /quality endpoint.

ALTER TABLE content_archive_items
  ADD COLUMN IF NOT EXISTS autopilot_approved BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE content_localizations
  ADD COLUMN IF NOT EXISTS migration_action TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_localizations_migration_action_chk'
  ) THEN
    ALTER TABLE content_localizations
      ADD CONSTRAINT content_localizations_migration_action_chk
      CHECK (
        migration_action IS NULL OR migration_action IN (
          'keep',
          'expand',
          'merge',
          'redirect',
          'noindex',
          'rewrite_b',
          'rewrite_c',
          'promote_a'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_archive_items_autopilot_approved
  ON content_archive_items (autopilot_approved)
  WHERE autopilot_approved = TRUE;

CREATE INDEX IF NOT EXISTS idx_content_localizations_migration_action
  ON content_localizations (migration_action)
  WHERE migration_action IS NOT NULL AND migration_action <> 'keep';
