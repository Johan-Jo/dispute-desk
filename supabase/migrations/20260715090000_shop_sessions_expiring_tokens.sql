-- Expiring offline tokens (docs/plans/expiring-offline-tokens.plan.md).
--
-- Shopify now REJECTS Admin API calls made with legacy non-expiring
-- offline tokens ("[API] Non-expiring access tokens are no longer
-- accepted for the Admin API"). Observed live on the dev shop
-- surasvenne — every background Admin call (sync, pack build, policy
-- ingest, webhook re-registration) fails until the shop's session is
-- upgraded to the expiring variant (1h access token + 90d refresh
-- token, refreshed server-side).
--
-- token_expiring=false (default) marks every session minted before
-- this migration — the legacy variant. Sessions minted or upgraded via
-- token-exchange with expiring=1 set it true and populate the refresh
-- columns.

alter table shop_sessions
  add column if not exists refresh_token_encrypted text,
  add column if not exists refresh_token_expires_at timestamptz,
  add column if not exists token_expiring boolean not null default false,
  add column if not exists refresh_claimed_at timestamptz;

comment on column shop_sessions.refresh_token_encrypted is
  'AES-256-GCM encrypted refresh token (expiring offline tokens only). NULL for legacy non-expiring sessions.';
comment on column shop_sessions.refresh_token_expires_at is
  'Refresh-token expiry (90 days from mint/refresh, per Shopify). NULL for legacy non-expiring sessions.';
comment on column shop_sessions.token_expiring is
  'true once the session was minted/upgraded to the expiring-token variant (access_token ~1h TTL + refresh_token). false = legacy non-expiring token, which Shopify now rejects for background Admin API calls.';
comment on column shop_sessions.refresh_claimed_at is
  'Optimistic claim timestamp so concurrent background jobs do not race Shopify''s single-use rotating refresh_token. Claims older than 30s are reclaimable — see lib/shopify/sessions/refreshOfflineToken.ts.';
