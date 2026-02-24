-- Seed data for local development

insert into shops (id, shop_domain, shop_id, plan)
values (
  '00000000-0000-0000-0000-000000000001',
  'dev-store.myshopify.com',
  'gid://shopify/Shop/1',
  'pro'
)
on conflict (shop_domain) do nothing;
