-- Add `dismissed_banners` JSONB column to shops for per-shop banner
-- dismissal state. Replaces the localStorage-only dismissal flags
-- used by the embedded dashboard banners — those were per-device,
-- so a merchant dismissing on desktop still saw the banner on
-- mobile. JSONB rather than separate scalar columns so new banner
-- IDs can be added without further migrations.
--
-- Shape: `{ "<banner_id>": "<iso8601_timestamp>" }`. Presence of a
-- key (regardless of value) means dismissed. The timestamp value is
-- carried so future "dismissed_at > X days ago re-surface" logic
-- has data to read; v1 ignores the value.
--
-- Banner IDs currently in use:
--   - scope_upgrade   — re-OAuth nudge for read_all_orders
--                       (DashboardScopeUpgradeBanner.tsx)

alter table shops
  add column if not exists dismissed_banners jsonb not null default '{}'::jsonb;

comment on column shops.dismissed_banners is
  'Per-shop banner dismissal state. JSONB map: banner_id -> ISO8601 dismissed_at. Replaces localStorage flags (which were per-device) so dismissals persist across browsers/devices.';
