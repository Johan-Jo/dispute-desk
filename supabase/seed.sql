-- Seed data for local development (minimal bootstrapping only).
-- No dispute rows here; use npm run seed:synthetic-disputes for DB-only test disputes.
-- For Shopify-backed test data, see docs/testing-store-mirror.md.

insert into shops (id, shop_domain, shop_id, plan)
values (
  '00000000-0000-0000-0000-000000000001',
  'dev-store.myshopify.com',
  'gid://shopify/Shop/1',
  'growth'
)
on conflict (shop_domain) do nothing;
