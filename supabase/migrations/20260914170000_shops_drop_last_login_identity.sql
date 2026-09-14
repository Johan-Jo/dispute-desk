-- 20260914170000: drop shops.last_login_name / last_login_email
--
-- Added in 20260914120000 to hold a staff member's display name,
-- resolved via Shopify's `staffMember` query. That query needs the
-- `read_users` scope, and adding a scope to the live app changes its
-- consent set and pushes already-installed merchants through a re-auth.
-- A re-auth that lands on the legacy OAuth callback mints a
-- non-expiring token, which Shopify now rejects outright — killing
-- webhooks, dispute sync, policy ingest and pack builds for that shop
-- (observed on dev 2026-09-14; see docs/technical.md § Expiring Offline
-- Tokens). Not a risk worth taking for a display name.
--
-- The feature keeps WHEN (last_login_at) and the free, already-verified
-- numeric staff id from the session token (last_login_user_id, enough
-- to tell one staff member's session from another's). Both columns
-- always stayed null, so no data is lost.
alter table shops
  drop column if exists last_login_name,
  drop column if exists last_login_email;

comment on column shops.last_login_user_id is
  'Numeric Shopify staff user id (session token `sub` claim). Distinguishes one staff member from another; not resolvable to a name without the read_users scope.';
