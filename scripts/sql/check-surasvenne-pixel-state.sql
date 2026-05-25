-- Check Web Pixel registration & emission state for surasvenne.
-- The pixel GID is not persisted in our DB (fire-and-forget on OAuth), so
-- the only signals we have are:
--   1. Shop exists and is installed (so OAuth ran → registerWebPixel was called)
--   2. checkout_sessions rows exist (proves the pixel is actually emitting)

WITH shop AS (
  SELECT id, shop_domain, installed_at, uninstalled_at
  FROM shops
  WHERE shop_domain ILIKE '%surasvenne%'
)
SELECT
  s.shop_domain,
  s.id                                AS shop_id,
  s.installed_at,
  s.uninstalled_at,
  (SELECT count(*) FROM checkout_sessions cs WHERE cs.shop_id = s.id)
                                      AS total_sessions,
  (SELECT count(*) FROM checkout_sessions cs
   WHERE cs.shop_id = s.id
     AND cs.created_at >= now() - interval '7 days')
                                      AS sessions_last_7d,
  (SELECT max(created_at) FROM checkout_sessions cs WHERE cs.shop_id = s.id)
                                      AS last_session_at,
  (SELECT min(created_at) FROM checkout_sessions cs WHERE cs.shop_id = s.id)
                                      AS first_session_at
FROM shop s;
