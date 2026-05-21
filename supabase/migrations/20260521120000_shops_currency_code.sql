-- shops.currency_code — the merchant's Shopify presentment currency
-- (from `shop { currencyCode }` on the Admin GraphQL API). Populated
-- at OAuth install and refreshed on shop/update webhook.
--
-- Used by the dashboard as the PREFERRED display currency for the
-- Recovered / Lost / At Risk tiles. The metrics layer still falls
-- back to "most-frequent currency across this shop's disputes" when
-- this column is null (older installs, before this migration).
--
-- ISO-4217 alpha-3, e.g. "USD", "EUR", "SEK". Null until populated.

alter table public.shops
  add column if not exists currency_code text;

comment on column public.shops.currency_code is
  'Shopify shop primary/presentment currency (ISO-4217 alpha-3). Source of truth for dashboard display currency. Refreshed via shop/update webhook.';
