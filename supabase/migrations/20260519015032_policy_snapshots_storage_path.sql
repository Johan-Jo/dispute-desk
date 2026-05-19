-- Add storage_path column to policy_snapshots so we can stop storing
-- 1-year Supabase signed URLs directly in the row.
--
-- Before this migration, policy_snapshots.url held a signed URL with a
-- 1-year TTL. That URL was returned by /api/policies (GET) and reached
-- the portal Policies page client component, which means the URL +
-- token landed in the browser and any logs that captured it. Same
-- exposure class as the dispute PDF signed-URL leak fixed in commit
-- 4dcca13.
--
-- This migration:
--   1. Adds policy_snapshots.storage_path (nullable for now).
--   2. Backfills storage_path from any existing url whose shape
--      matches a Supabase signed URL for the policy-uploads bucket.
--      The path lives between "/sign/policy-uploads/" and the "?".
--   3. Leaves policy_snapshots.url in place so the deploy is
--      backwards-compatible. A follow-up migration after the writer +
--      reader switch can drop the url column.
--
-- Going forward, /api/policies/upload and /api/policies/apply write
-- only storage_path. /api/policies/[id]/file streams bytes through
-- the origin, so no signed URL ever reaches the browser.

ALTER TABLE policy_snapshots
  ADD COLUMN IF NOT EXISTS storage_path text;

-- Backfill: extract the storage path from any existing signed URLs.
-- Supabase signed URLs are shaped like:
--   https://<proj>.supabase.co/storage/v1/object/sign/policy-uploads/<path>?token=<jwt>
-- regexp_replace strips the host prefix and the query string, leaving
-- just <path>. Rows that don't match (e.g. older rows, future shape
-- changes) keep storage_path NULL and are handled by the proxy route's
-- 404 path.
UPDATE policy_snapshots
SET storage_path = regexp_replace(
  regexp_replace(url, '^.*/sign/policy-uploads/', ''),
  '\?.*$',
  ''
)
WHERE url IS NOT NULL
  AND storage_path IS NULL
  AND url LIKE '%/sign/policy-uploads/%';

-- Index for the proxy route lookup. The route fetches by id + shop_id
-- (RLS-enforced), so an id index already exists via the PK. No new
-- index needed.
