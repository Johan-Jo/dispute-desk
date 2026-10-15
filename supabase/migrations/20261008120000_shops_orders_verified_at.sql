-- No-orders install gate (docs/plans/no-orders-install-gate.plan.md).
--
-- `orders_verified_at` is stamped the first time we confirm a shop has real
-- activity (an order, or a dispute). NULL = not yet verified. The embedded app
-- layout only calls Shopify while it is NULL, so a verified shop costs one
-- column read per load and never a Shopify round-trip.
--
-- Every shop that exists TODAY is grandfathered: they installed under the old
-- rules and must not be locked out by this deploy. Only shops created after
-- this migration start with NULL.

alter table shops
  add column if not exists orders_verified_at timestamptz;

comment on column shops.orders_verified_at is
  'First time the shop was confirmed to have orders or disputes. NULL = unverified; the embedded app shows the no-orders screen while NULL and the Shopify order check finds nothing. Existing shops were backfilled at migration time.';

update shops
   set orders_verified_at = now()
 where orders_verified_at is null;
