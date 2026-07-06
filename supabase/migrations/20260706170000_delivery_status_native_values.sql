-- Document the additional delivery_status values produced by the
-- native-carrier delivery derivation (lib/shopify/deliveryEventClassifier).
--
-- Context (2026-07-06, cay-collective / PostNord): carrier integrations
-- sync PostNord delivery into Shopify's native Fulfillment.events[].message
-- but leave deliveredAt null and the event status enum stale (a FAILURE
-- from an earlier return-to-sender persists across re-delivery). We now
-- classify delivery from the event message timeline. This adds two values
-- beyond the original tracking-app vocabulary:
--   - DeliveredToPickup: arrived at / collected at a pickup point / service
--     point / parcel locker — NOT the customer's own address. Does not
--     count as confirmed delivery in the "Confirmed deliveries" KPI.
--   - Returned: returned to sender (not delivered).
--
-- No data migration — delivery_status is a plain text column with no CHECK
-- constraint; existing rows are unaffected and re-ingest repopulates them.

comment on column shopify_orders.delivery_status is
  'Normalized delivery status. From tracking-app metafields (aftership / shipway / parcelpanel / wonderment / trackingmore): Delivered | InTransit | OutForDelivery | AttemptFail | Exception | Expired | unknown. From native Shopify fulfillment events (tracking_source = shopify_native, via lib/shopify/deliveryEventClassifier): Delivered | DeliveredToPickup | Returned. Only "Delivered" counts as confirmed delivery in the Insights KPI.';
