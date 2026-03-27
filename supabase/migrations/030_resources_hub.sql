-- 030: DisputeDesk Resources Hub — content CMS, archive, publish queue

-- ─── Authors & reviewers (display personas) ─────────────────────────────
CREATE TABLE authors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  role        text,
  bio         text,
  avatar_url  text,
  credentials text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE reviewers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  role        text,
  bio         text,
  credentials text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ─── CTAs ───────────────────────────────────────────────────────────────
CREATE TABLE content_ctas (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type                text NOT NULL,
  destination         text NOT NULL,
  event_name          text NOT NULL,
  localized_copy_json jsonb NOT NULL DEFAULT '{}',
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ─── Core content item (language-agnostic) ─────────────────────────────
CREATE TABLE content_items (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_type       text NOT NULL CHECK (content_type IN (
    'pillar_page', 'cluster_article', 'template', 'case_study',
    'legal_update', 'glossary_entry', 'faq_entry'
  )),
  primary_pillar     text NOT NULL CHECK (primary_pillar IN (
    'chargebacks', 'dispute-resolution', 'small-claims',
    'mediation-arbitration', 'dispute-management-software'
  )),
  audience           text,
  funnel_stage       text,
  jurisdiction       text,
  workflow_status    text NOT NULL DEFAULT 'idea' CHECK (workflow_status IN (
    'idea', 'backlog', 'brief-ready', 'drafting', 'in-translation',
    'in-editorial-review', 'in-legal-review', 'approved', 'scheduled',
    'published', 'archived'
  )),
  featured_image_url text,
  primary_cta_id     uuid REFERENCES content_ctas(id) ON DELETE SET NULL,
  secondary_cta_id   uuid REFERENCES content_ctas(id) ON DELETE SET NULL,
  author_id          uuid REFERENCES authors(id) ON DELETE SET NULL,
  reviewer_id        uuid REFERENCES reviewers(id) ON DELETE SET NULL,
  publish_priority   int NOT NULL DEFAULT 100,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  published_at       timestamptz
);

CREATE INDEX idx_content_items_pillar ON content_items(primary_pillar);
CREATE INDEX idx_content_items_type ON content_items(content_type);
CREATE INDEX idx_content_items_workflow ON content_items(workflow_status);

-- ─── Per-locale content ─────────────────────────────────────────────────
CREATE TABLE content_localizations (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id       uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  locale                text NOT NULL CHECK (locale IN (
    'en-US', 'de-DE', 'fr-FR', 'es-ES', 'pt-PT', 'sv-SE'
  )),
  route_kind            text NOT NULL CHECK (route_kind IN (
    'resources', 'templates', 'case-studies', 'glossary', 'blog'
  )),
  title                 text NOT NULL DEFAULT '',
  slug                  text NOT NULL DEFAULT '',
  excerpt               text NOT NULL DEFAULT '',
  body_json             jsonb NOT NULL DEFAULT '{}',
  meta_title            text NOT NULL DEFAULT '',
  meta_description      text NOT NULL DEFAULT '',
  og_title              text NOT NULL DEFAULT '',
  og_description        text NOT NULL DEFAULT '',
  reading_time_minutes  int,
  publish_at            timestamptz,
  is_published          boolean NOT NULL DEFAULT false,
  translation_status    text NOT NULL DEFAULT 'missing' CHECK (translation_status IN (
    'missing', 'draft', 'complete'
  )),
  reviewed_at           timestamptz,
  last_updated_at       timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (content_item_id, locale)
);

CREATE UNIQUE INDEX uq_content_localizations_slug
  ON content_localizations(locale, route_kind, slug)
  WHERE slug <> '' AND is_published = true;

CREATE INDEX idx_content_localizations_item ON content_localizations(content_item_id);
CREATE INDEX idx_content_localizations_publish ON content_localizations(is_published, publish_at);
CREATE INDEX idx_content_localizations_locale ON content_localizations(locale);

-- ─── Tags ───────────────────────────────────────────────────────────────
CREATE TABLE content_tags (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key  text NOT NULL UNIQUE
);

CREATE TABLE content_item_tags (
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  tag_id          uuid NOT NULL REFERENCES content_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (content_item_id, tag_id)
);

-- ─── Revisions ─────────────────────────────────────────────────────────
CREATE TABLE content_revisions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_item_id uuid NOT NULL REFERENCES content_items(id) ON DELETE CASCADE,
  locale          text NOT NULL,
  snapshot_json   jsonb NOT NULL,
  created_by      text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_revisions_item ON content_revisions(content_item_id);

-- ─── Archive / backlog ───────────────────────────────────────────────────
CREATE TABLE content_archive_items (
  id                                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  proposed_title                      text NOT NULL,
  proposed_slug                       text,
  target_locale_set                   text[] NOT NULL DEFAULT '{}',
  content_type                        text NOT NULL,
  primary_pillar                      text NOT NULL,
  priority_score                      int NOT NULL DEFAULT 50,
  target_keyword                      text,
  search_intent                       text,
  summary                             text,
  notes                               text,
  status                              text NOT NULL DEFAULT 'backlog',
  created_from_archive_to_content_item_id uuid REFERENCES content_items(id) ON DELETE SET NULL,
  created_at                          timestamptz NOT NULL DEFAULT now(),
  updated_at                          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_archive_pillar ON content_archive_items(primary_pillar);
CREATE INDEX idx_content_archive_priority ON content_archive_items(priority_score DESC);

-- ─── Publish queue (not shop jobs) ─────────────────────────────────────
CREATE TABLE content_publish_queue (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content_localization_id  uuid NOT NULL REFERENCES content_localizations(id) ON DELETE CASCADE,
  scheduled_for            timestamptz NOT NULL,
  status                   text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'processing', 'succeeded', 'failed'
  )),
  last_error               text,
  attempts                 int NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_content_publish_queue_due
  ON content_publish_queue(status, scheduled_for)
  WHERE status = 'pending';

-- ─── CMS settings (scheduler) ──────────────────────────────────────────
CREATE TABLE cms_settings (
  id    text PRIMARY KEY DEFAULT 'singleton',
  settings_json jsonb NOT NULL DEFAULT '{
    "defaultPublishTimeUtc": "09:00",
    "weekendsEnabled": true,
    "skipIfTranslationIncomplete": true,
    "minScheduledDaysWarning": 14
  }'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO cms_settings (id) VALUES ('singleton') ON CONFLICT DO NOTHING;

-- RLS: service role only (same pattern as jobs)
ALTER TABLE authors ENABLE ROW LEVEL SECURITY;
ALTER TABLE reviewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_ctas ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_localizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_item_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_archive_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_publish_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE cms_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_authors" ON authors FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_reviewers" ON reviewers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_ctas" ON content_ctas FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_items" ON content_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_localizations" ON content_localizations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_tags" ON content_tags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_item_tags" ON content_item_tags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_revisions" ON content_revisions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_archive" ON content_archive_items FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_content_publish_queue" ON content_publish_queue FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "service_role_cms_settings" ON cms_settings FOR ALL USING (true) WITH CHECK (true);
