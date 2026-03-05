-- 021: Fix duplicate offline sessions caused by NULL user_id in unique constraint.
-- PostgreSQL treats NULLs as distinct, so unique(shop_id, session_type, user_id)
-- allowed multiple offline sessions per shop. Clean up duplicates and add a
-- partial unique index that properly enforces one offline session per shop.

-- Step 1: Delete duplicate offline sessions, keeping only the most recent per shop.
DELETE FROM shop_sessions
WHERE id IN (
  SELECT id FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY shop_id
        ORDER BY created_at DESC
      ) AS rn
    FROM shop_sessions
    WHERE session_type = 'offline' AND user_id IS NULL
  ) ranked
  WHERE rn > 1
);

-- Step 2: Add a partial unique index that enforces one offline session per shop.
-- This works correctly with NULL user_id (partial index filters on the condition).
CREATE UNIQUE INDEX IF NOT EXISTS idx_sessions_offline_unique
  ON shop_sessions (shop_id)
  WHERE session_type = 'offline' AND user_id IS NULL;
