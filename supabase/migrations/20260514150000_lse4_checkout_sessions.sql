-- LSE-4: storefront session capture for CE 3.0 / FPT evidence.
--
-- Stores privacy-safe session signals captured by the LSE-4 storefront
-- extensions (app embed block, Web Pixel, Checkout UI extension). Joined
-- to orders via `cart_token`. Used by LSE-1's qualification engine to
-- match IP / device fingerprint / account login state across the
-- disputed order and priors.
--
-- v1 capture set (privacy-safe defaults — see EPIC-LSE-4):
--   cart_token, session_started_at, user_agent, ip_hash, ip_raw
--   (encrypted), ip_geo (country + region), customer_id, customer
--   account age, customer_login_state_at_checkout, page-view history,
--   time on checkout page, consent signals (DNT / GPC).
--
-- 18-month retention TTL covers the 365-day CE 3.0 prior window + 6
-- months buffer for late-arriving disputes. Nightly job
-- expire_checkout_sessions deletes expired rows.
--
-- See docs/epics/EPIC-LSE-4-session-capture.md.

create table if not exists checkout_sessions (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,

  -- Join key to Shopify order. Unique per shop — re-emitting on the same
  -- cart upserts.
  cart_token text not null,

  session_started_at timestamptz not null default now(),
  order_placed_at timestamptz,
  shopify_order_id text,

  -- IP: hashed at rest for queries (sha256 + per-shop salt). Encrypted
  -- raw value kept separately and only decrypted at qualification time.
  ip_hash text,
  ip_raw_encrypted bytea,
  ip_geo_country text,
  ip_geo_region text,

  user_agent text,
  customer_id text,
  customer_account_age_days int,
  customer_login_state_at_checkout text check (
    customer_login_state_at_checkout is null
    or customer_login_state_at_checkout in ('logged_in', 'guest', 'unknown')
  ),

  session_history jsonb not null default '[]'::jsonb,
  time_on_checkout_page_ms int,

  -- Privacy consent: DNT / GPC headers seen at ingest time.
  consent_signals jsonb not null default '{}'::jsonb,

  -- 18 months from creation by default.
  retention_expires_at timestamptz not null default (now() + interval '18 months'),

  created_at timestamptz not null default now()
);

-- Lookups:
--   * by cart_token (for order match-back) — unique per shop
--   * by shopify_order_id (qualification engine pulling session data)
--   * by retention_expires_at (nightly TTL job)
create unique index if not exists checkout_sessions_shop_cart_uq
  on checkout_sessions (shop_id, cart_token);
create index if not exists checkout_sessions_shop_order_idx
  on checkout_sessions (shop_id, shopify_order_id)
  where shopify_order_id is not null;
create index if not exists checkout_sessions_retention_idx
  on checkout_sessions (retention_expires_at)
  where retention_expires_at is not null;

alter table checkout_sessions enable row level security;
drop policy if exists service_role_full_access_checkout_sessions on checkout_sessions;
create policy service_role_full_access_checkout_sessions
  on checkout_sessions for all using (true) with check (true);

comment on table checkout_sessions is
  'LSE-4 storefront session capture. Privacy-safe v1 capture set. 18-month TTL. IPs hashed at rest; raw IP encrypted, decryption only during qualification.';
comment on column checkout_sessions.cart_token is
  'Shopify cart_token — the join key from storefront session to order. Unique per shop.';
comment on column checkout_sessions.consent_signals is
  'JSON object recording the privacy signals observed at ingest: {dnt: bool, gpc: bool}. Used to gate downstream processing under LGPD/GDPR/CCPA.';
comment on column checkout_sessions.retention_expires_at is
  'When the row is hard-deleted by the nightly expire_checkout_sessions job. Default now() + 18 months.';
