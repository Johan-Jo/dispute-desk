-- Manual ordering for the content backlog (drag-and-drop). Lower rank = earlier in queue.
ALTER TABLE content_archive_items
  ADD COLUMN IF NOT EXISTS backlog_rank integer NOT NULL DEFAULT 1000000;

CREATE INDEX IF NOT EXISTS idx_content_archive_backlog_rank
  ON content_archive_items (backlog_rank);

-- Preserve current effective ordering: priority (desc), then age (asc).
UPDATE content_archive_items AS a
SET backlog_rank = sub.rnk
FROM (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      ORDER BY priority_score DESC NULLS LAST, created_at ASC NULLS LAST
    )) * 100 AS rnk
  FROM content_archive_items
) AS sub
WHERE a.id = sub.id;
