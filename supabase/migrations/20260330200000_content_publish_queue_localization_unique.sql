-- Required for upsert/onConflict on content_localization_id (editor schedule, publishContentItemThroughQueue).
-- Dedupe legacy rows: keep the newest row per localization.

DELETE FROM content_publish_queue q
USING (
  SELECT id
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY content_localization_id
        ORDER BY created_at DESC, id DESC
      ) AS rn
    FROM content_publish_queue
  ) ranked
  WHERE ranked.rn > 1
) dup
WHERE q.id = dup.id;

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_publish_queue_content_localization_id
  ON content_publish_queue (content_localization_id);
