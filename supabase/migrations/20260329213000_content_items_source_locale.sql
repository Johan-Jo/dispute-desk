-- Editorial "article language": which hub locale this piece is considered authored in.
-- Distinct from per-locale rows in content_localizations (translations).

ALTER TABLE content_items
  ADD COLUMN IF NOT EXISTS source_locale text;

CREATE INDEX IF NOT EXISTS idx_content_items_source_locale ON content_items(source_locale);

-- Backfill: among complete localizations, pick the locale with the largest body_json (proxy for primary copy).
UPDATE content_items ci
SET source_locale = sub.locale
FROM (
  SELECT DISTINCT ON (cl.content_item_id)
    cl.content_item_id,
    cl.locale
  FROM content_localizations cl
  WHERE cl.translation_status = 'complete'
  ORDER BY
    cl.content_item_id,
    length(coalesce(cl.body_json::text, '')) DESC,
    cl.locale ASC
) sub
WHERE ci.id = sub.content_item_id
  AND ci.source_locale IS NULL;

ALTER TABLE content_items DROP CONSTRAINT IF EXISTS content_items_source_locale_check;

ALTER TABLE content_items ADD CONSTRAINT content_items_source_locale_check
  CHECK (
    source_locale IS NULL
    OR source_locale IN ('en-US', 'de-DE', 'fr-FR', 'es-ES', 'pt-BR', 'sv-SE')
  );
