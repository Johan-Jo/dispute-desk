-- 20260520120000: webhook_events — Layer A delivery idempotency for Shopify webhooks
--
-- Each incoming webhook is claimed by (shop_id, event_id) where event_id is the
-- X-Shopify-Webhook-Id UUID Shopify sends with every delivery (stable across
-- retries). Subsequent deliveries of the same event collide on the unique
-- constraint and are treated as duplicate_event.
--
-- payload_excerpt stores ONLY allowlisted fields built by
-- lib/webhooks/eventIdempotency.ts#buildSafePayloadExcerpt. Raw webhook bodies
-- are NEVER stored — see docs/runbooks/webhook-delivery.md.

create table webhook_events (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references shops(id) on delete cascade,
  event_id text not null,
  topic text not null,
  shopify_object_id text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text,
  error_message text,
  payload_excerpt jsonb,
  processing_ms integer,
  constraint webhook_events_event_id_unique unique (shop_id, event_id)
);

create index idx_webhook_events_shop_received
  on webhook_events (shop_id, received_at desc);

create index idx_webhook_events_object
  on webhook_events (shopify_object_id)
  where shopify_object_id is not null;

create index idx_webhook_events_outcome_received
  on webhook_events (outcome, received_at desc);

alter table webhook_events enable row level security;

-- No policies — service-role only (matches the rest of the webhook tables).
-- Authenticated portal users never read this directly.

comment on table webhook_events is
  'Layer A delivery idempotency for Shopify webhooks. Keyed on (shop_id, X-Shopify-Webhook-Id). payload_excerpt is allowlisted only — never raw body.';
comment on column webhook_events.event_id is
  'X-Shopify-Webhook-Id header value (UUID, stable across Shopify retries).';
comment on column webhook_events.outcome is
  'applied | skipped_unchanged | duplicate_event | error | error_schema_validation | skipped_unknown_shop | skipped_stale | skipped_monotonic_guard';
comment on column webhook_events.payload_excerpt is
  'Structured allowlist excerpt only. Never the raw webhook body.';
