-- Hub SEO fields for content_items
--
-- is_hub_article: marks an article as the cluster hub/pillar for its topic.
--   Used for JSON-LD, sitemap priority, and admin display. Sort order is
--   controlled by publish_priority (set to 9999 on hub articles via admin API).
--
-- curated_related_ids: ordered list of content_item IDs for the curated Related
--   Resources section at the bottom of article pages. The backend validates each
--   ID is published before rendering; unresolved IDs are silently dropped.
--   Never used to generate inline body links — only the bottom related section.

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS is_hub_article BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS curated_related_ids UUID[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_content_items_is_hub_article
  ON content_items (is_hub_article)
  WHERE is_hub_article = TRUE;
