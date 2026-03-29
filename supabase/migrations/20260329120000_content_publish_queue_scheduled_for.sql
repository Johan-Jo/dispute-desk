-- Repair: code and 030_resources_hub.sql expect content_publish_queue.scheduled_for.
-- Some environments created or altered this table without the column (schema drift).

ALTER TABLE content_publish_queue
  ADD COLUMN IF NOT EXISTS scheduled_for timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN content_publish_queue.scheduled_for IS
  'UTC time when the row becomes eligible for publish-queue ticks (lte comparison).';

CREATE INDEX IF NOT EXISTS idx_content_publish_queue_due
  ON content_publish_queue (status, scheduled_for)
  WHERE status = 'pending';
