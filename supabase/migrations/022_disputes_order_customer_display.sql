-- 022: Add order_name and customer_display_name to disputes for list display.

alter table disputes
  add column if not exists order_name text,
  add column if not exists customer_display_name text;

comment on column disputes.order_name is 'Order display name from Shopify (e.g. #1066)';
comment on column disputes.customer_display_name is 'Customer display name from order.customer.displayName';
