-- 20260914120000: shops.last_login_* — merchant last-seen tracking
--
-- Powers the "Last login" column on the internal admin Shops table
-- (app/admin/shops). Nothing previously recorded merchant activity:
-- shop_sessions only reflects install time (offline, user_id always
-- null) and token-refresh events, not actual page views.
--
-- Populated from Shopify's session token (id_token), which every
-- embedded page load carries and which is already cryptographically
-- verified in lib/shopify/sessionToken.ts. The token's `sub` claim is
-- the numeric Shopify staff user id — free, no extra API call.
-- last_login_name/last_login_email are resolved separately via the
-- Shopify staffMember GraphQL query (requires the read_users scope;
-- see shopify.app.{dev,prod}.toml) and are best-effort: existing
-- merchants must re-consent before that call succeeds, so these two
-- columns stay null until a shop re-authorizes with the new scope.
alter table shops
  add column last_login_at         timestamptz,
  add column last_login_user_id    text,
  add column last_login_name       text,
  add column last_login_email      text;

comment on column shops.last_login_at is
  'Timestamp of the most recent verified embedded-app page load (from Shopify session token), throttled to ~once per 5 minutes per shop.';
comment on column shops.last_login_user_id is
  'Numeric Shopify staff user id (session token `sub` claim). Always populated once a login is recorded.';
comment on column shops.last_login_name is
  'Staff member display name, resolved via Shopify staffMember query. Null until the shop re-consents with the read_users scope.';
comment on column shops.last_login_email is
  'Staff member email, resolved via Shopify staffMember query. Null until the shop re-consents with the read_users scope.';
