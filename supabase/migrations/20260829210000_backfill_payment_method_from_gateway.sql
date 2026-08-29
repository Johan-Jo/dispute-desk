-- Backfill shopify_orders.payment_method from payment_gateway.
--
-- Why: pickPaymentMethod derived the method only from the transaction's
-- `paymentDetails` union. A PayPal or standalone-Klarna transaction is
-- typed as the bare `PaymentDetails` interface, so neither
-- `paymentMethodName` nor `wallet` resolves and the method stored null.
-- The admin Risk Profile then mapped null to "other", reporting a
-- payment method the merchant never used at whatever share the gap
-- happened to be — 86.6% of orders on one PayPal-heavy shop.
--
-- The code fix adds a gateway fallback for future ingest. This repairs
-- the rows already written, using exactly the same rule so both paths
-- agree: a gateway that IS a payment method names the method; a card
-- acquirer does not, and those rows stay null (genuinely unknown, and
-- now reported as "unknown" rather than "other").
--
-- Idempotent: only touches rows where payment_method IS NULL, and the
-- deny-list is stable, so re-running is a no-op.

update public.shopify_orders
set payment_method = lower(regexp_replace(btrim(payment_gateway), '[\s-]+', '_', 'g'))
where payment_method is null
  and payment_gateway is not null
  and btrim(payment_gateway) <> ''
  and lower(regexp_replace(btrim(payment_gateway), '[\s-]+', '_', 'g')) not in (
    -- Generic gateways: the name says nothing about how the shopper
    -- actually paid. Mirrors GENERIC_GATEWAYS in
    -- lib/shopify/queries/ordersForBackfill.ts.
    'shopify_payments',
    'checkout',
    'checkout_com',
    'mollie',
    'worldpay',
    'authorize_net',
    'cybersource',
    'nuvei',
    'manual',
    'bogus'
  )
  -- Acquirer families. An acquirer arrives under many connector names
  -- (prod carries stripe_connect and carro_stripe as well as stripe),
  -- and each one hides a card behind it. Mirrors ACQUIRER_FAMILIES.
  and lower(regexp_replace(btrim(payment_gateway), '[\s-]+', '_', 'g'))
      !~ '(stripe|braintree|adyen)';
