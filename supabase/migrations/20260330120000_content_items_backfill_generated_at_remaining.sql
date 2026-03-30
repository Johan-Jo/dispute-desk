-- Backfill generated_at for any remaining rows where it is still null.
-- The first backfill (20260329231500) only covered articles that had a
-- content_revision with created_by = 'ai-generation'. This catches the rest
-- (e.g. seed data or articles created before revisions were tracked).
-- Safe because all articles in this system are AI-generated.

UPDATE content_items
SET generated_at = created_at
WHERE generated_at IS NULL;
