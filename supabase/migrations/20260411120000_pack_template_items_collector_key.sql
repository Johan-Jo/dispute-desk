-- Add collector_key to pack_template_items so admin-defined items can
-- explicitly point at a collector field (lib/packs/sources/*). Before
-- this column the runtime completeness engine ignored template items
-- entirely and used a parallel hardcoded REASON_TEMPLATES map in
-- lib/automation/completeness.ts. With this column, evaluateCompleteness
-- can load the items for a pack's template and match each item against
-- what the collectors actually emitted.
--
-- NULL means "no automated source — the merchant must provide this,
-- satisfied by any manual upload (supporting_documents)".

ALTER TABLE pack_template_items
  ADD COLUMN collector_key text;

COMMENT ON COLUMN pack_template_items.collector_key IS
  'Collector field name (see lib/packs/sources) that satisfies this item at runtime. NULL = merchant-supplied only.';

-- ─── Backfill: order-derived items ──────────────────────────────────
UPDATE pack_template_items SET collector_key = 'order_confirmation'
  WHERE key IN (
    'order_confirmation',
    'payment_receipt',
    'payment_records',
    'invoice_receipts',
    'order_itemization',
    'pricing_screenshot',
    'product_page_screenshot',
    'product_description'
  );

-- ─── Backfill: billing/address match from order ─────────────────────
UPDATE pack_template_items SET collector_key = 'billing_address_match'
  WHERE key IN (
    'billing_shipping_match',
    'billing_history'
  );

-- ─── Backfill: shipping/tracking from fulfillment ───────────────────
UPDATE pack_template_items SET collector_key = 'shipping_tracking'
  WHERE key IN (
    'tracking_proof',
    'tracking_number',
    'carrier_confirmation',
    'shipping_receipt',
    'partial_tracking'
  );

-- ─── Backfill: delivery proof from fulfillment ──────────────────────
UPDATE pack_template_items SET collector_key = 'delivery_proof'
  WHERE key IN (
    'delivery_signature',
    'delivery_photo',
    'delivery_address_match',
    'delivery_confirmation'
  );

-- ─── Backfill: store policies ───────────────────────────────────────
UPDATE pack_template_items SET collector_key = 'shipping_policy'
  WHERE key = 'shipping_policy';

UPDATE pack_template_items SET collector_key = 'refund_policy'
  WHERE key IN (
    'refund_policy',
    'return_policy',
    'return_policy_url',
    'refund_receipt'
  );

UPDATE pack_template_items SET collector_key = 'cancellation_policy'
  WHERE key = 'cancellation_policy';

-- ─── Backfill: customer communication ───────────────────────────────
UPDATE pack_template_items SET collector_key = 'customer_communication'
  WHERE key IN (
    'customer_emails',
    'customer_account_info'
  );

-- All other existing items keep collector_key NULL on purpose — they
-- are merchant-supplied (fraud screening notes, device fingerprint,
-- IP geolocation, usage/login logs, digital delivery logs, subscription
-- agreement, packing slip, etc.) and are satisfied at runtime by any
-- manual upload (supporting_documents).
