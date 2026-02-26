-- 018: Template Library + Multilingual Narratives
-- Drops old shop-scoped pack_templates and rebuilds as global template catalog
-- plus shop-bound packs with narrative support.

-- ─── 1. Drop legacy tables ──────────────────────────────────────────
DROP TABLE IF EXISTS pack_template_documents CASCADE;
DROP TABLE IF EXISTS pack_template_i18n CASCADE;
DROP TABLE IF EXISTS pack_templates CASCADE;

-- ─── 2. Global template catalog ─────────────────────────────────────

CREATE TABLE pack_templates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text UNIQUE NOT NULL,
  dispute_type    text NOT NULL,
  is_recommended  boolean NOT NULL DEFAULT false,
  min_plan        text NOT NULL DEFAULT 'FREE',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE pack_template_i18n (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id       uuid NOT NULL REFERENCES pack_templates(id) ON DELETE CASCADE,
  locale            text NOT NULL,
  name              text NOT NULL,
  short_description text NOT NULL,
  works_best_for    text,
  preview_note      text,
  UNIQUE (template_id, locale)
);

CREATE INDEX idx_pti18n_template ON pack_template_i18n(template_id);
CREATE INDEX idx_pti18n_template_locale ON pack_template_i18n(template_id, locale);

CREATE TABLE pack_template_sections (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id     uuid NOT NULL REFERENCES pack_templates(id) ON DELETE CASCADE,
  title_key       text NOT NULL,
  title_default   text NOT NULL,
  sort            int NOT NULL DEFAULT 0
);

CREATE INDEX idx_pts_template ON pack_template_sections(template_id);

CREATE TABLE pack_template_items (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_section_id   uuid NOT NULL REFERENCES pack_template_sections(id) ON DELETE CASCADE,
  item_type             text NOT NULL,
  key                   text NOT NULL,
  label_default         text NOT NULL,
  required              boolean NOT NULL DEFAULT false,
  guidance_default      text,
  sort                  int NOT NULL DEFAULT 0
);

CREATE INDEX idx_ptitems_section ON pack_template_items(template_section_id);

-- ─── 3. Shop-bound packs (instances) ────────────────────────────────

CREATE TABLE packs (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           uuid NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name              text NOT NULL,
  code              text,
  dispute_type      text NOT NULL,
  status            text NOT NULL DEFAULT 'DRAFT'
                      CHECK (status IN ('DRAFT','ACTIVE','ARCHIVED')),
  source            text NOT NULL DEFAULT 'MANUAL'
                      CHECK (source IN ('MANUAL','TEMPLATE')),
  template_id       uuid REFERENCES pack_templates(id) ON DELETE SET NULL,
  documents_count   int NOT NULL DEFAULT 0,
  usage_count       int NOT NULL DEFAULT 0,
  last_used_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_dispute_packs_shop ON packs(shop_id);
CREATE INDEX idx_dispute_packs_shop_status ON packs(shop_id, status);
CREATE INDEX idx_dispute_packs_template ON packs(template_id);

CREATE TABLE pack_sections (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id   uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  title     text NOT NULL,
  sort      int NOT NULL DEFAULT 0
);

CREATE INDEX idx_psections_pack ON pack_sections(pack_id);

CREATE TABLE pack_section_items (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  section_id  uuid NOT NULL REFERENCES pack_sections(id) ON DELETE CASCADE,
  item_type   text NOT NULL,
  key         text NOT NULL,
  label       text NOT NULL,
  required    boolean NOT NULL DEFAULT false,
  guidance    text,
  sort        int NOT NULL DEFAULT 0
);

CREATE INDEX idx_psitems_section ON pack_section_items(section_id);

-- ─── 4. Narrative settings & drafts ─────────────────────────────────

CREATE TABLE pack_narrative_settings (
  pack_id                               uuid PRIMARY KEY REFERENCES packs(id) ON DELETE CASCADE,
  store_locale                          text NOT NULL DEFAULT 'auto',
  include_english                       boolean NOT NULL DEFAULT true,
  include_store_language                boolean NOT NULL DEFAULT true,
  attach_translated_customer_messages   boolean NOT NULL DEFAULT false
);

CREATE TABLE pack_narratives (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pack_id     uuid NOT NULL REFERENCES packs(id) ON DELETE CASCADE,
  locale      text NOT NULL,
  content     text NOT NULL,
  source      text NOT NULL DEFAULT 'USER'
                CHECK (source IN ('USER','GENERATED')),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (pack_id, locale)
);

CREATE INDEX idx_pnarr_pack ON pack_narratives(pack_id);

-- ─── 5. RLS policies ────────────────────────────────────────────────

ALTER TABLE pack_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_template_i18n ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_template_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_sections ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_section_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_narrative_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE pack_narratives ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_full_access_pack_templates"
  ON pack_templates FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_template_i18n"
  ON pack_template_i18n FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_template_sections"
  ON pack_template_sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_template_items"
  ON pack_template_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_packs"
  ON packs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_sections"
  ON pack_sections FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_section_items"
  ON pack_section_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_narrative_settings"
  ON pack_narrative_settings FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_full_access_pack_narratives"
  ON pack_narratives FOR ALL USING (true) WITH CHECK (true);

-- ─── 6. updated_at trigger (reusable) ───────────────────────────────

CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_pack_templates_updated_at
  BEFORE UPDATE ON pack_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_packs_updated_at
  BEFORE UPDATE ON packs
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TRIGGER trg_pack_narratives_updated_at
  BEFORE UPDATE ON pack_narratives
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
