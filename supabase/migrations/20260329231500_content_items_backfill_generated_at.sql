-- Backfill generated_at for rows that have an AI generation revision but null generated_at
-- (e.g. legacy data or pipeline edge cases). Reset & rebuild requires generated_at to be set.

UPDATE content_items AS ci
SET generated_at = sub.first_ai
FROM (
  SELECT content_item_id,
         min(created_at) AS first_ai
  FROM content_revisions
  WHERE created_by = 'ai-generation'
  GROUP BY content_item_id
) AS sub
WHERE ci.id = sub.content_item_id
  AND ci.generated_at IS NULL;
