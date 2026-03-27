-- Add generation tracking columns to content_revisions and content_items

-- Allow snapshot_json to be nullable (generation revisions only record metadata)
ALTER TABLE content_revisions ALTER COLUMN snapshot_json DROP NOT NULL;

-- Add analytics columns to content_revisions
ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS change_summary text;
ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS edit_distance int;
ALTER TABLE content_revisions ADD COLUMN IF NOT EXISTS tokens_used int DEFAULT 0;

-- Add generation metadata to content_items
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS generated_at timestamptz;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS generation_tokens int DEFAULT 0;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS rejection_reason text;
ALTER TABLE content_items ADD COLUMN IF NOT EXISTS time_to_publish interval;

-- Allow 'converted' as a valid status for archive items
-- (no constraint to change since status is just text)
