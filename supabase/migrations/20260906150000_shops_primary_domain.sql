-- Persist the storefront's real domain (Shopify `Shop.primaryDomain.url`).
--
-- `shops.shop_domain` is the myshopify alias — `6a8848-dd.myshopify.com` for a
-- store that customers actually reach at `meinmaison.com`. Ops surfaces (the
-- admin Shops list) had nothing but that opaque alias to identify a merchant
-- by, and cardholders/issuers never see it at all. Same reasoning as
-- `shop_name` (20260829150000): recovering it later needs a live Admin call
-- with an offline token that may since have expired or been revoked.
--
-- Populated by `persistShopCurrency`, which already fetches `primaryDomain`
-- in the same `ShopDetails` query on install and refreshes on the shop/update
-- webhook, so a domain change propagates. Stored as the bare host (no scheme,
-- no trailing slash) because every consumer wants to display or compare a
-- hostname, not a URL.
--
-- Nullable: enrichment is best-effort and must never block an install. A shop
-- with no custom domain reports its myshopify host here, which is correct —
-- that IS its primary domain.
alter table shops add column if not exists primary_domain text;

comment on column shops.primary_domain is
  'Storefront primary domain host from Shopify Shop.primaryDomain.url, scheme stripped (e.g. "meinmaison.com"). Distinct from shop_domain, which is the myshopify alias. Equal to the myshopify host when the shop has no custom domain. Nullable — best-effort enrichment, refreshed on the shop/update webhook.';
