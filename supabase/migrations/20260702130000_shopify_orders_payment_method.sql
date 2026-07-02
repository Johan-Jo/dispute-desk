-- Fraud-intelligence — payment_method column on shopify_orders.
--
-- Problem: `shopify_orders.payment_gateway` only stores the top-level
-- gateway name (`paymentGatewayNames[0]`), which is `shopify_payments`
-- for virtually every Shopify Payments order. That single value
-- collapses card / Apple Pay / Klarna / other BNPL & local methods into
-- one bucket, so we cannot tell — from stored data alone — that (for
-- example) ~53% of a shop's volume is Klarna. This matters directly for
-- chargeback analytics: Klarna and other BNPL methods have distinct
-- dispute profiles, and a Klarna chargeback that clears through Shopify
-- Payments is currently indistinguishable from a plain card chargeback.
--
-- Fix: persist the actual payment-method family, derived from the
-- primary transaction's `paymentDetails` union:
--   - CardPaymentDetails with a wallet     -> "apple_pay" / "google_pay" / "shop_pay"
--   - CardPaymentDetails without a wallet   -> "card"
--   - LocalPaymentMethodsPaymentDetails     -> paymentMethodName (e.g. "klarna", "ideal")
--   - anything else / unknown               -> null (never guess)
-- The derivation lives in lib/shopify/queries/ordersForBackfill.ts
-- (pickPaymentMethod) so backfill + webhook ingest share one shape.
--
-- Mutable: like customer_email/customer_gid, this column CAN be
-- rewritten by re-ingestion. The immutability trigger on shopify_orders
-- (migration 20260510150000) guards only risk_*_initial; payment_method
-- is deliberately not covered — later ingests should update to the
-- latest observed value.

alter table shopify_orders
  add column if not exists payment_method text;

comment on column shopify_orders.payment_method is
  'Payment method family derived from the primary transaction paymentDetails union: card | apple_pay | google_pay | shop_pay | klarna | <local method name> | null. Distinct from payment_gateway (always shopify_payments for SP orders). Mutable — re-ingested orders update to the latest observed value. Populated for all post-2026-07-02 ingests; older rows are backfilled via scripts/backfill-payment-method.mjs.';

-- Partial index: analytics queries filter/group by method (e.g.
-- "chargeback rate by payment_method"). Partial keeps it small — rows
-- with a null method (unknown / not-yet-backfilled) don't contribute.
create index if not exists shopify_orders_shop_payment_method_idx
  on shopify_orders (shop_id, payment_method)
  where payment_method is not null;
