-- 031: Add planning columns to content_items for editorial operations admin
-- content_archive_items already has these; now content_items needs them too
-- for the dashboard, list filters, and backlog-to-draft conversion.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS target_keyword text,
  ADD COLUMN IF NOT EXISTS search_intent text,
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium'
    CHECK (priority IN ('high', 'medium', 'low'));

CREATE INDEX IF NOT EXISTS idx_content_items_priority ON content_items(priority);
CREATE INDEX IF NOT EXISTS idx_content_items_topic ON content_items(topic);
