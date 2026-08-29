-- Persist the merchant-facing store name (Shopify `Shop.name`).
--
-- `shops.shop_domain` holds only the myshopify subdomain — e.g. `6a8848-dd`
-- for a store actually called "Mein Maison". The real name existed nowhere in
-- our database, so any merchant-facing copy (the install welcome email) or ops
-- surface had to either show the opaque subdomain or make a live Admin API
-- call with the offline token. Once that token expires or is revoked, the name
-- becomes unrecoverable.
--
-- Populated by `persistShopCurrency` (which already fetches Shop details on
-- install and refreshes on the shop/update webhook, so a rename propagates).
-- Nullable: enrichment is best-effort and must never block an install.
alter table shops add column if not exists shop_name text;

comment on column shops.shop_name is
  'Merchant-facing store name from Shopify Shop.name (e.g. "Mein Maison"). Distinct from shop_domain, which is the myshopify subdomain. Nullable — best-effort enrichment, refreshed on the shop/update webhook.';
