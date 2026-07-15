-- Carrier Delivery Verification — PR 1A: normalized fulfillment-tracking
-- persistence + carrier alert-incident dedup storage.
-- Plan: docs/plans/carrier-delivery-verification.plan.md §6.4, §9 (PR 1A).
--
-- shopify_fulfillment_trackings: one row per (fulfillment, tracking entry).
-- shopify_orders keeps only the single best collapsed delivery signal per
-- order; carrier-API resolution (PR 1B/1C) needs the per-shipment truth —
-- one order can hold many fulfillments, many tracking numbers, and mixed
-- carriers. Shopify-sourced columns are refreshed on every ingest; the
-- carrier-lookup cache columns are written only by the adapter layer and
-- must survive re-ingest untouched.
--
-- carrier_alert_incidents: persistent notification dedup — serverless
-- workers share no process memory, so alert-storm suppression state must
-- live in the database. One row per stable incident key.
--
-- Access pattern: service-role only. RLS enabled with no policies,
-- matching shopify_orders / shop_daily_metrics — anon/authenticated see
-- nothing, service role bypasses.

-- ─── shopify_fulfillment_trackings ────────────────────────────────────────

create table shopify_fulfillment_trackings (
  id                        uuid        primary key default gen_random_uuid(),
  shop_id                   uuid        not null references shops(id) on delete cascade,

  -- Shopify identity
  shopify_order_id          text        not null,   -- gid://shopify/Order/<n>
  shopify_fulfillment_id    text        not null,   -- gid://shopify/Fulfillment/<n>

  -- Tracking entry as Shopify stores it
  company_raw               text,                   -- verbatim trackingInfo.company
  tracking_number           text,                   -- verbatim trackingInfo.number (may be a non-tracking reference; see effective_tracking_id)
  tracking_url              text,
  -- Dedup key: tracking_number, else tracking_url, else ''. Computed by
  -- the normalizer (not a generated column) so PostgREST onConflict works.
  tracking_key              text        not null,

  -- Carrier resolution (written by the adapter layer, PR 1B+)
  carrier_normalized        text,                   -- registry slug, e.g. 'dhl'; null until identified
  carrier_adapter           text,                   -- adapter that claimed the entry, when any
  effective_tracking_id     text,                   -- the REAL identifier sent to the carrier API (may be URL-derived)
  identifier_source         text        check (identifier_source in ('number', 'url', 'company_and_number')),

  -- Shipment state
  fulfillment_status        text,                   -- Shopify displayStatus at last ingest
  shipment_status           text,                   -- per-shipment classification: Delivered | DeliveredToPickup | Returned
  terminal_at               timestamptz,            -- timestamp of the authoritative terminal event
  tracking_source           text,                   -- which source supplied shipment_status (shopify_native | carrier_api_<slug> | …)

  -- Line-item coverage (populated from the pack-build path, PR 1C —
  -- ingest queries deliberately do not fetch fulfillmentLineItems)
  line_item_coverage        jsonb,
  quantity_covered          integer,

  -- Carrier-lookup cache (adapter layer only — never touched by ingest)
  last_carrier_lookup_at     timestamptz,
  last_carrier_lookup_result text,                  -- CarrierLookupResult.status of the last attempt
  adapter_version            text,
  classification_version     text,

  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),

  unique (shop_id, shopify_fulfillment_id, tracking_key)
);

create index shopify_fulfillment_trackings_shop_order_idx
  on shopify_fulfillment_trackings (shop_id, shopify_order_id);

create index shopify_fulfillment_trackings_carrier_idx
  on shopify_fulfillment_trackings (shop_id, carrier_normalized)
  where carrier_normalized is not null;

alter table shopify_fulfillment_trackings enable row level security;
-- No policies: service-role only. Matches shopify_orders convention.

comment on table shopify_fulfillment_trackings is
  'One row per Shopify fulfillment tracking entry. Per-shipment source of truth for carrier delivery verification (docs/plans/carrier-delivery-verification.plan.md). shopify_orders keeps only the collapsed best per-order signal.';
comment on column shopify_fulfillment_trackings.tracking_key is
  'Dedup key within a fulfillment: tracking_number, else tracking_url, else empty string. Part of the upsert conflict target.';
comment on column shopify_fulfillment_trackings.effective_tracking_id is
  'The identifier actually usable against the carrier API. For DHL Freight the stored tracking_number is DHL''s customer confirmation number; the real id is parsed from the tracking URL (tracking-id= param).';
comment on column shopify_fulfillment_trackings.shipment_status is
  'Per-shipment delivery classification (Delivered | DeliveredToPickup | Returned) from the newest sufficiently reliable terminal event across sources. Never infer non-delivery from null.';
comment on column shopify_fulfillment_trackings.last_carrier_lookup_result is
  'status of the most recent CarrierLookupResult (success | not_found | ambiguous | rate_limited | …). Written only by the adapter layer; ingest never touches lookup-cache columns.';

-- ─── carrier_alert_incidents ──────────────────────────────────────────────

create table carrier_alert_incidents (
  id                    uuid        primary key default gen_random_uuid(),
  environment           text        not null,   -- development | preview | production
  incident_key          text        not null unique,
  carrier               text,                   -- normalized slug when known
  shop_id               uuid        references shops(id) on delete cascade,
  category              text        not null,   -- error category or unsupported_carrier / unknown_carrier
  occurrence_count      integer     not null default 1,
  first_seen_at         timestamptz not null default now(),
  last_seen_at          timestamptz not null default now(),
  last_notified_at      timestamptz,
  suppressed_until      timestamptz,
  sample_correlation_id text
);

create index carrier_alert_incidents_carrier_idx
  on carrier_alert_incidents (environment, category, carrier);

alter table carrier_alert_incidents enable row level security;
-- No policies: service-role only.

comment on table carrier_alert_incidents is
  'Persistent dedup + occurrence ledger for carrier-integration support notifications (plan §6.4, §7.3). incident_key = environment + carrier + shop + (fulfillment id | masked tracking ref) + category (operational errors) or environment + unsupported_carrier + carrier + shop (unsupported-carrier alerts). Also the product-demand signal for future adapters.';
comment on column carrier_alert_incidents.suppressed_until is
  'No further notification email for this incident key until this instant; occurrences keep incrementing while suppressed. Default window: 6h operational errors, 7d unsupported-carrier.';
