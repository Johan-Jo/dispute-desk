-- Tracking-app data captured from Shopify metafields (AfterShip,
-- Shipway, ParcelPanel, Wonderment, TrackingMore, etc.). When a
-- merchant has any of these apps installed AND has the "sync to
-- Shopify" setting enabled, those apps write normalized delivery
-- data into Shopify metafields under their own namespace. We can
-- read it for free during backfill — no merchant action required,
-- no AfterShip API key needed.
--
-- Captured at both backfill time (for aggregate dashboard KPIs)
-- AND at dispute-pack-build time (for per-dispute evidence). The
-- pack-build path is where signature data wins fraud disputes —
-- the bank rebuttal cites "carrier confirmed delivery, signed for
-- by {name}" when the data is present, which is one of the
-- strongest possible evidence types for FRAUDULENT chargebacks.

alter table shopify_orders
  add column if not exists delivery_status text,
  add column if not exists delivered_at_tracking timestamptz,
  add column if not exists signed_by_name text,
  add column if not exists tracking_source text;

comment on column shopify_orders.delivery_status is
  'Normalized delivery status from tracking-app metafields: Delivered | InTransit | OutForDelivery | AttemptFail | Exception | Expired | unknown. Mapped from per-app schemas (aftership / shipway / parcelpanel / wonderment / trackingmore) into a unified vocabulary.';
comment on column shopify_orders.delivered_at_tracking is
  'Carrier-confirmed delivered timestamp from tracking-app metafield. More reliable than Shopify''s Fulfillment.deliveredAt because tracking apps poll carrier APIs continuously. NULL when not delivered yet, or when the merchant has no tracking app.';
comment on column shopify_orders.signed_by_name is
  'Recipient name on signature confirmation from carrier (when carrier captured it). NULL when no signature was required or no name was captured. Gold-tier evidence for fraud disputes — cited verbatim in bank rebuttals.';
comment on column shopify_orders.tracking_source is
  'Which tracking app supplied this row''s delivery_status / signed_by_name. Values: aftership | shipway | parcelpanel | wonderment | trackingmore | shopify_native | null. NULL when no tracking-app metafield was found.';

-- Hot-path indexes for the dashboard KPIs:
--   - "% of orders confirmed delivered in last 30d" — filter by
--     delivered_at_tracking date
--   - "% of orders signed-for" — filter on signed_by_name NOT NULL
create index if not exists shopify_orders_delivered_tracking_idx
  on shopify_orders (shop_id, delivered_at_tracking)
  where delivered_at_tracking is not null;

create index if not exists shopify_orders_signed_for_idx
  on shopify_orders (shop_id, processed_at)
  where signed_by_name is not null;
