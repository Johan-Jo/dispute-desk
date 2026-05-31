-- Pro-tier Supabase projects ship with restrictive default privileges:
-- the `anon`, `authenticated`, and `service_role` roles only receive
-- REFERENCES, TRIGGER, and TRUNCATE on newly-created tables. That's
-- insufficient for an app whose server-side queries run as `service_role`
-- and whose RLS-controlled merchant queries run as `authenticated`.
--
-- The original (Free-tier) project this codebase grew up on had the older,
-- more permissive defaults where all three app roles received full DML on
-- new tables automatically. None of the prior migrations contain explicit
-- GRANT statements because they relied on that legacy default.
--
-- This migration codifies the GRANTs explicitly so:
--   1. Any future fresh Supabase Pro project receives the right grants
--      from `supabase db push` without manual repair.
--   2. Future tables (added by later migrations) also pick up the grants
--      via ALTER DEFAULT PRIVILEGES.
--
-- Idempotent. Safe to re-run. On the migration-set's original (Free-tier)
-- project the GRANTs are a no-op because they already exist. On Pro
-- projects this is the fix.
--
-- Reference: prod-release-log.md entry for the 2026-05-28 Pro cutover.

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON ALL TABLES IN SCHEMA public
  TO authenticated, service_role;
GRANT USAGE, SELECT
  ON ALL SEQUENCES IN SCHEMA public
  TO authenticated, service_role;
GRANT EXECUTE
  ON ALL FUNCTIONS IN SCHEMA public
  TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES
  TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES
  TO authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS
  TO authenticated, service_role;
