-- 010_automation.sql — Automation-first pipeline: shop settings + evidence pack fields
-- Supports the automation pivot: auto-build, auto-save, review gates

-- ============================================================
-- 1. shop_settings — per-store automation configuration
-- ============================================================
CREATE TABLE IF NOT EXISTS shop_settings (
  shop_id           uuid PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  auto_build_enabled         boolean NOT NULL DEFAULT true,
  auto_save_enabled          boolean NOT NULL DEFAULT false,
  require_review_before_save boolean NOT NULL DEFAULT true,
  auto_save_min_score        int     NOT NULL DEFAULT 80
                             CHECK (auto_save_min_score BETWEEN 0 AND 100),
  enforce_no_blockers        boolean NOT NULL DEFAULT true,
  created_at                 timestamptz NOT NULL DEFAULT now(),
  updated_at                 timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE shop_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_shop_settings"
  ON shop_settings FOR ALL
  USING (true) WITH CHECK (true);

-- ============================================================
-- 2. Extend evidence_packs with automation fields
-- ============================================================

-- Widen the status CHECK to include automation states.
-- Existing values: queued, building, ready, failed, archived.
-- Adding: draft, blocked, saved_to_shopify.
ALTER TABLE evidence_packs DROP CONSTRAINT IF EXISTS evidence_packs_status_check;
ALTER TABLE evidence_packs ADD CONSTRAINT evidence_packs_status_check
  CHECK (status IN (
    'queued', 'building', 'ready', 'failed', 'archived',
    'draft', 'blocked', 'saved_to_shopify'
  ));

ALTER TABLE evidence_packs
  ADD COLUMN IF NOT EXISTS blockers              jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS recommended_actions   jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS saved_to_shopify_at   timestamptz,
  ADD COLUMN IF NOT EXISTS approved_for_save_at  timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by_user_id   uuid;

-- ============================================================
-- 3. Helper: ensure shop_settings row exists (upsert default)
-- ============================================================
CREATE OR REPLACE FUNCTION ensure_shop_settings(p_shop_id uuid)
RETURNS shop_settings
LANGUAGE plpgsql AS $$
DECLARE
  result shop_settings;
BEGIN
  INSERT INTO shop_settings (shop_id)
  VALUES (p_shop_id)
  ON CONFLICT (shop_id) DO NOTHING;

  SELECT * INTO result FROM shop_settings WHERE shop_id = p_shop_id;
  RETURN result;
END;
$$;
