-- Canonicalization + sitemap-exclusion fields on content_localizations.
--
-- These three fields drive PR 4's redirect/canonicalization mechanism and
-- the rewrite queue (PR 5) for the resource hub overhaul:
--
--   redirect_to_localization_id  — when set, the route handler issues a 301
--                                  permanentRedirect to the target row's URL.
--                                  Used to merge near-duplicate articles into
--                                  one canonical version without breaking
--                                  inbound links to the old slug.
--   is_excluded_from_sitemap     — manual exclude flag used by app/sitemap.ts
--                                  to omit a row from the public sitemap
--                                  even while it remains live (e.g. while
--                                  awaiting a rewrite).
--   quality_status               — one of: published | thin | rewrite_pending
--                                  | redirected | excluded. The audit script
--                                  populates this; sitemap excludes everything
--                                  except 'published'.
--
-- All three are nullable / default-off so existing rows are unaffected.

ALTER TABLE content_localizations
  ADD COLUMN IF NOT EXISTS redirect_to_localization_id UUID REFERENCES content_localizations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS is_excluded_from_sitemap BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS quality_status TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_localizations_quality_status_chk'
  ) THEN
    ALTER TABLE content_localizations
      ADD CONSTRAINT content_localizations_quality_status_chk
      CHECK (
        quality_status IS NULL OR quality_status IN (
          'published',
          'thin',
          'rewrite_pending',
          'redirected',
          'excluded'
        )
      );
  END IF;
END $$;

-- A redirect must not point at itself.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_localizations_no_self_redirect_chk'
  ) THEN
    ALTER TABLE content_localizations
      ADD CONSTRAINT content_localizations_no_self_redirect_chk
      CHECK (redirect_to_localization_id IS NULL OR redirect_to_localization_id <> id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_localizations_redirect_target
  ON content_localizations (redirect_to_localization_id)
  WHERE redirect_to_localization_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_content_localizations_excluded_from_sitemap
  ON content_localizations (is_excluded_from_sitemap)
  WHERE is_excluded_from_sitemap = TRUE;

CREATE INDEX IF NOT EXISTS idx_content_localizations_quality_status
  ON content_localizations (quality_status)
  WHERE quality_status IS NOT NULL AND quality_status <> 'published';
