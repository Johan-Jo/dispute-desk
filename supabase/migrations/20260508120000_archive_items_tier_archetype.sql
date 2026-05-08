-- Tier + archetype + hub-flag on content_archive_items.
--
-- These three fields let the editorial brief steer the generation pipeline
-- (see lib/resources/generation/tiers.ts):
--
--   tier_override (A | B | C)  — controls target word range and minimum depth.
--   archetype                  — controls which structural-commitment block is
--                                injected into the model prompt.
--   is_hub_article             — marks the brief as the canonical pillar for its
--                                topic; promotes tier inference to A and is
--                                propagated onto the content_item on conversion.
--
-- All three are optional. When NULL the pipeline infers from content_type.

ALTER TABLE content_archive_items
  ADD COLUMN IF NOT EXISTS tier_override TEXT,
  ADD COLUMN IF NOT EXISTS archetype TEXT,
  ADD COLUMN IF NOT EXISTS is_hub_article BOOLEAN NOT NULL DEFAULT FALSE;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_archive_items_tier_override_chk'
  ) THEN
    ALTER TABLE content_archive_items
      ADD CONSTRAINT content_archive_items_tier_override_chk
      CHECK (tier_override IS NULL OR tier_override IN ('A', 'B', 'C'));
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'content_archive_items_archetype_chk'
  ) THEN
    ALTER TABLE content_archive_items
      ADD CONSTRAINT content_archive_items_archetype_chk
      CHECK (
        archetype IS NULL OR archetype IN (
          'authority_pillar',
          'merchant_playbook',
          'evidence_deep_dive',
          'regulatory_explainer',
          'comparative_analysis',
          'decision_framework',
          'checklist_actionable',
          'template_fillin',
          'faq_qna',
          'case_study',
          'policy_implementation',
          'tooling_overview',
          'definition_glossary'
        )
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_content_archive_items_is_hub_article
  ON content_archive_items (is_hub_article)
  WHERE is_hub_article = TRUE;
