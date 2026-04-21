-- Split customer_account_info template requirement from customer_communication.
--
-- Before: migration 20260411120000 mapped both `customer_emails` and
-- `customer_account_info` template keys to the single collector field
-- `customer_communication`. The embedded app then rendered two checklist
-- rows ("Customer correspondence" + "Customer account details") with
-- identical previews, because both resolved to the same collected field.
--
-- Fix: point `customer_account_info` at its own collector field of the
-- same name. A new collector in lib/packs/sources/orderSource.ts emits
-- `customer_account_info` using the customer profile already fetched by
-- ORDER_DETAIL_QUERY (numberOfOrders, createdAt, note), so no extra
-- Shopify calls and no schema change to evidence_packs.

UPDATE pack_template_items
SET collector_key = 'customer_account_info'
WHERE key = 'customer_account_info';
