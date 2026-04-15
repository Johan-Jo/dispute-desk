-- Add requirement_mode to pack_template_items for conditional evidence requirements.
-- Modes:
--   required_always         – always required (default for existing required=true items)
--   required_if_fulfilled   – required only when order has been shipped
--   required_if_card_payment – required only when payment method is a card
--   recommended             – not required but weighted in scoring
--   optional                – nice to have, low weight

ALTER TABLE pack_template_items
  ADD COLUMN IF NOT EXISTS requirement_mode text NOT NULL DEFAULT 'required_always';

-- Backfill: existing required=false items default to 'optional'
UPDATE pack_template_items
  SET requirement_mode = 'optional'
  WHERE required = false;

-- AVS/CVV items: conditional on card payment
UPDATE pack_template_items
  SET requirement_mode = 'required_if_card_payment'
  WHERE key = 'avs_cvv_match';

-- Shipping/tracking items: conditional on fulfillment
UPDATE pack_template_items
  SET requirement_mode = 'required_if_fulfilled'
  WHERE key IN ('tracking_proof', 'tracking_number', 'carrier_confirmation',
                'shipping_receipt', 'partial_tracking');

-- Delivery items: conditional on fulfillment
UPDATE pack_template_items
  SET requirement_mode = 'required_if_fulfilled'
  WHERE key IN ('delivery_signature', 'delivery_photo', 'delivery_address_match',
                'delivery_confirmation');

-- Recommended items (valuable but not blocking)
UPDATE pack_template_items
  SET requirement_mode = 'recommended'
  WHERE key IN ('ip_geolocation', 'device_fingerprint', 'fraud_screening_notes',
                'usage_logs', 'login_activity');
