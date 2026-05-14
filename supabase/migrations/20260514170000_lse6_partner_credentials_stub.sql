-- LSE-6: schema stub for Verifi + Ethoca direct submission channels.
--
-- IMPORTANT: This migration adds the table and shop-settings columns
-- needed by LSE-6, but DOES NOT enable any partner submission. LSE-6
-- engineering is gated on Verifi or Ethoca commercial partnership
-- agreements (see docs/epics/EPIC-LSE-6-direct-submission.md).
--
-- Adding the schema now means:
--   1. `submission_logs.channel` already supports 'verifi' and 'ethoca'
--      (added in LSE-2 migration).
--   2. When a partnership signs, the only DB changes needed are
--      populating `lse_partner_credentials` and flipping
--      `lse_<partner>_enabled` per shop.
--   3. Direct submission code paths can be developed against this
--      schema without further migrations.
--
-- DO NOT populate this table or enable any flag until partnership
-- credentials are validated against a real Verifi / Ethoca sandbox.

-- ── shop_settings extension ──────────────────────────────────────────
alter table shop_settings
  add column if not exists lse_verifi_enabled boolean not null default false,
  add column if not exists lse_verifi_credentials_id uuid,
  add column if not exists lse_ethoca_enabled boolean not null default false,
  add column if not exists lse_ethoca_credentials_id uuid,
  add column if not exists lse_keep_shopify_parallel boolean not null default true;

comment on column shop_settings.lse_verifi_enabled is
  'LSE-6: when true, qualifying CE 3.0 packages are submitted directly to Verifi VROL alongside (or instead of) the Shopify dispute API. Default false — partnership-gated.';
comment on column shop_settings.lse_ethoca_enabled is
  'LSE-6: when true, ready FPT packages are submitted directly to Ethoca Consumer Clarity. Default false — partnership-gated.';
comment on column shop_settings.lse_keep_shopify_parallel is
  'LSE-6: when true, submit via Shopify dispute API in parallel with direct partner channels during the trust-building A/B period. Default true — flip to false only after direct channels have proven win-rate parity.';

-- ── lse_partner_credentials ──────────────────────────────────────────
create table if not exists lse_partner_credentials (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid not null references shops(id) on delete cascade,
  partner text not null check (partner in ('verifi', 'ethoca')),
  credentials_encrypted bytea not null,
  valid_through timestamptz,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

-- One active credential per (shop, partner).
create unique index if not exists lse_partner_credentials_shop_partner_active_uq
  on lse_partner_credentials (shop_id, partner)
  where revoked_at is null;

alter table lse_partner_credentials enable row level security;
drop policy if exists service_role_full_access_lse_partner_creds on lse_partner_credentials;
create policy service_role_full_access_lse_partner_creds
  on lse_partner_credentials for all using (true) with check (true);

comment on table lse_partner_credentials is
  'LSE-6 stub: encrypted partner credentials (Verifi / Ethoca). Created in advance of partnership signing — table empty until a commercial agreement closes. Use AES-256-GCM via lib/security/encryption.ts for encryption.';
