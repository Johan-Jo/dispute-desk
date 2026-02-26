-- 017: Migrate locale columns to BCP-47 tags and add i18n support
-- Supports: en-US, de-DE, fr-FR, es-ES, pt-BR, sv-SE

-- ─── 1. Migrate shops.locale from 2-letter codes to BCP-47 ─────────
UPDATE shops SET locale = CASE locale
  WHEN 'en' THEN 'en-US'
  WHEN 'de' THEN 'de-DE'
  WHEN 'fr' THEN 'fr-FR'
  WHEN 'es' THEN 'es-ES'
  WHEN 'pt' THEN 'pt-BR'
  WHEN 'sv' THEN 'sv-SE'
  ELSE 'en-US'
END
WHERE locale NOT LIKE '%-%';

ALTER TABLE shops
  ALTER COLUMN locale SET DEFAULT 'en-US';

-- ─── 2. Add user_locale to portal_user_profiles ────────────────────
ALTER TABLE portal_user_profiles
  ADD COLUMN IF NOT EXISTS user_locale TEXT;

COMMENT ON COLUMN portal_user_profiles.user_locale IS
  'BCP-47 locale preference (e.g. fr-FR). NULL = inherit from shop.';

-- ─── 3. Create pack_template_i18n for template translations ────────
CREATE TABLE IF NOT EXISTS pack_template_i18n (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id   uuid NOT NULL REFERENCES pack_templates(id) ON DELETE CASCADE,
  locale        text NOT NULL,
  name          text NOT NULL,
  description   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (template_id, locale)
);

CREATE INDEX idx_pack_template_i18n_template
  ON pack_template_i18n(template_id);
CREATE INDEX idx_pack_template_i18n_locale
  ON pack_template_i18n(template_id, locale);

ALTER TABLE pack_template_i18n ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_pack_template_i18n"
  ON pack_template_i18n FOR ALL
  USING (true)
  WITH CHECK (true);
